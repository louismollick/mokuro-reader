<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import { createDisplayController } from 'yomitan-core';
  import type { AnkiNoteContext, SegmentToken, TermDictionaryEntry, Yomitan } from 'yomitan-core';
  import type { VolumeMetadata } from '$lib/anki-connect';
  import { settings } from '$lib/settings';
  import { getYomitan } from '$lib/yomitan/client';
  import { createMokuroAnkiTransport } from '$lib/yomitan/anki-transport';
  import { buildBoxText, type BoxText } from '$lib/yomitan/box-text';
  import { showHighlight, tapOffset } from '$lib/yomitan/box-dom';
  import { createKanjiInfoLoader } from '$lib/yomitan/kanji-data';
  import type { LookupRequest } from '$lib/yomitan/lookup-request';
  import {
    backTitle,
    currentView,
    popView,
    pushView,
    selectWord,
    startHistory,
    type LookupHistory
  } from '$lib/yomitan/lookup-session';
  import { NoteStates } from '$lib/yomitan/note-states';
  import { pickWordIndex } from '$lib/yomitan/word-pick';
  import KanjiView from './KanjiView.svelte';
  import SentenceStrip from './SentenceStrip.svelte';
  import WordView from './WordView.svelte';

  interface Props {
    /** The current Tap Lookup; null closes the sheet. */
    request: LookupRequest | null;
    ankiEnabled: boolean;
    volumeMetadata?: VolumeMetadata;
    onClose: () => void;
  }

  let { request, ankiEnabled, volumeMetadata, onClose }: Props = $props();

  /** Everything one Tap Lookup resolved to. */
  interface Session {
    request: LookupRequest;
    client: Yomitan;
    box: BoxText;
    tokens: SegmentToken[];
    glossaryStyle: { css: string; attributes: Record<string, string> };
    noteStates: NoteStates;
    /** Merged entries per looked-up text: one per word, with all its spellings and readings. */
    merged: Map<string, Promise<TermDictionaryEntry[]>>;
    loadKanji: ReturnType<typeof createKanjiInfoLoader>;
  }

  // ---- Lookup session --------------------------------------------------------------------

  let status = $state<'loading' | 'ready' | 'no-dictionaries' | 'error'>('loading');
  let session = $state.raw<Session | null>(null);
  let history = $state.raw<LookupHistory>(startHistory(null));
  let generation = 0;
  /** Segmentation per Text Box text, kept while the sheet stays open on a page. */
  const segmentations = new Map<string, Promise<SegmentToken[]>>();

  async function begin(next: LookupRequest) {
    const id = ++generation;
    status = 'loading';
    session = null;
    history = startHistory(null);
    expanded = false;

    // Read the tap's geometry before anything async: the page could move meanwhile.
    const box = buildBoxText(next.lines);
    const offset = tapOffset(next.textBox, box, next.lines, next.x, next.y);

    try {
      const client = await getYomitan();
      if (id !== generation) return;
      if (!client.profile.get().options.dictionaries.some(({ enabled }) => enabled)) {
        status = 'no-dictionaries';
        return;
      }

      const key = `${next.boxKey}|${box.text}`;
      let segmenting = segmentations.get(key);
      if (!segmenting) {
        segmenting = client.lookup.segment(box.text);
        segmentations.set(key, segmenting);
        segmenting.catch(() => segmentations.delete(key));
      }
      const [tokens, css] = await Promise.all([segmenting, client.render.css()]);
      if (id !== generation) return;

      session = {
        request: next,
        client,
        box,
        tokens,
        glossaryStyle: { css, attributes: client.render.attributes() },
        noteStates: new NoteStates(),
        merged: new Map(),
        loadKanji: createKanjiInfoLoader((character) => client.lookup.kanji(character))
      };
      history = startHistory(offset === null ? null : pickWordIndex(tokens, offset));
      status = 'ready';
    } catch (error) {
      if (id !== generation) return;
      console.error('Tap Lookup failed:', error);
      status = 'error';
    }
  }

  /**
   * The entries the Word View shows for a text: a merge-mode lookup, so a word with several
   * readings or spellings is one entry (Segmentation itself is unchanged). Falls back to the
   * segmentation's own entries if the lookup fails.
   */
  function wordEntries(current: Session, text: string, fallback: TermDictionaryEntry[] = []) {
    let entries = current.merged.get(text);
    if (!entries) {
      entries = current.client.lookup
        .terms(text, { mode: 'merge' })
        .then(({ entries: found }) => (found.length > 0 ? found : fallback))
        .catch(() => fallback);
      current.merged.set(text, entries);
    }
    return entries;
  }

  $effect(() => {
    if (!request) {
      segmentations.clear();
      return;
    }
    untrack(() => void begin(request));
  });

  let view = $derived(currentView(history));
  const wordText = (index: number) => session?.tokens[index]?.text;
  let backLabel = $derived(backTitle(history, wordText));

  // ---- Page highlight --------------------------------------------------------------------

  // The Word the Text Box's own view is on stays marked on the page while the sheet is open.
  $effect(() => {
    const root = history[0];
    if (!request || !session || root.kind !== 'box' || root.wordIndex === null) return;
    const token = session.tokens[root.wordIndex];
    return showHighlight(
      session.request.textBox,
      session.box.spans(token.range.start, token.range.end)
    );
  });

  // ---- Views -----------------------------------------------------------------------------

  /** The Sentence and page details Anki notes get for a Word at `start` in the Text Box. */
  function noteContextFor(client: Yomitan, box: BoxText, query: string, start: number) {
    const sentence =
      start >= 0
        ? client.lookup.sentence(box.text, start, query.length)
        : client.lookup.sentence(query, 0, query.length);
    return {
      sentence,
      url: window.location.href,
      documentTitle: document.title,
      query,
      fullQuery: query
    } satisfies AnkiNoteContext;
  }

  // Rebuilt whenever the AnkiConnect connection settings or Android mode change.
  let ankiTransportKey = $derived(
    [
      $settings.ankiConnectSettings.url,
      $settings.ankiConnectSettings.apiKey,
      $settings.ankiConnectSettings.androidModeOverride,
      $settings.ankiConnectSettings.connectionData?.isAndroid ?? false
    ].join('|')
  );
  let controller = $derived.by(() => {
    void ankiTransportKey;
    if (!ankiEnabled || !session) return null;
    return createDisplayController(session.client, {
      anki: createMokuroAnkiTransport(volumeMetadata)
    });
  });
  let extraMarkers = $derived({
    series: volumeMetadata?.seriesTitle ?? '',
    volume: volumeMetadata?.volumeTitle ?? ''
  });

  function openKanji(character: string) {
    history = pushView(history, { kind: 'kanji', character });
    // A Kanji View is taller than the peek and scrolls only in the full sheet.
    if (!desktop) expanded = true;
  }

  function openTerm(query: string) {
    history = pushView(history, { kind: 'term', query });
  }

  function back() {
    history = popView(history);
  }

  // ---- Sheet geometry and drag -----------------------------------------------------------

  const DESKTOP_MIN_WIDTH = 768;
  const HANDLE_HEIGHT = 28;
  const MIN_PEEK = 168;

  let viewportWidth = $state(window.innerWidth);
  let viewportHeight = $state(window.visualViewport?.height ?? window.innerHeight);
  let desktop = $derived(viewportWidth >= DESKTOP_MIN_WIDTH);

  function measureViewport() {
    viewportWidth = window.innerWidth;
    viewportHeight = window.visualViewport?.height ?? window.innerHeight;
  }

  onMount(() => {
    window.visualViewport?.addEventListener('resize', measureViewport);
    return () => window.visualViewport?.removeEventListener('resize', measureViewport);
  });

  /** Mounted closed, then opened a frame later so the first sheet slides in. */
  let open = $state(false);
  $effect(() => {
    if (!request) {
      open = false;
      return;
    }
    const frame = requestAnimationFrame(() => (open = true));
    return () => cancelAnimationFrame(frame);
  });

  let expanded = $state(false);
  let contentHeight = $state(0);
  let dragDy = $state(0);
  let dragging = $state(false);

  let sheetHeight = $derived(Math.round(viewportHeight * 0.92));
  /** Fits the header and first glosses, between 168 px and 45% of the viewport. */
  let peekHeight = $derived(
    Math.round(Math.min(Math.max(contentHeight + HANDLE_HEIGHT, MIN_PEEK), viewportHeight * 0.45))
  );
  let transform = $derived.by(() => {
    if (desktop) return `translateX(${open ? 0 : 100}%)`;
    const rest = !open ? sheetHeight + 24 : expanded ? 0 : sheetHeight - peekHeight;
    return `translateY(${Math.max(rest + dragDy, 0)}px)`;
  });
  let compact = $derived(!desktop && !expanded);

  let dragStart: { y: number; time: number } | null = null;

  function handlePointerDown(event: PointerEvent) {
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    dragStart = { y: event.clientY, time: event.timeStamp };
    dragging = true;
  }

  function handlePointerMove(event: PointerEvent) {
    if (dragStart) dragDy = event.clientY - dragStart.y;
  }

  /** Drag up opens to full, drag down steps full to peek and peek to closed; a tap toggles. */
  function handlePointerUp(event: PointerEvent) {
    if (!dragStart) return;
    const dy = event.clientY - dragStart.y;
    const fast = Math.abs(dy) / Math.max(event.timeStamp - dragStart.time, 1) > 0.5;
    dragStart = null;
    dragging = false;
    dragDy = 0;
    if (Math.abs(dy) < 8) expanded = !expanded;
    else if (dy < 0) expanded = dy < -(fast ? 20 : 48) || expanded;
    else if (expanded) expanded = dy < (fast ? 40 : 96);
    else if (dy > (fast ? 30 : 64)) onClose();
  }

  function handlePointerCancel() {
    dragStart = null;
    dragging = false;
    dragDy = 0;
  }

  function handleEscape(event: KeyboardEvent) {
    if (!request || event.key !== 'Escape') return;
    event.stopPropagation();
    event.preventDefault();
    onClose();
  }

  let scroller: HTMLDivElement | undefined = $state();
  $effect(() => {
    void history;
    scroller?.scrollTo(0, 0);
  });
</script>

<!-- Capture phase: Escape closes the sheet before Reader's and the layout's back navigation see it. -->
<svelte:window onresize={measureViewport} onkeydowncapture={handleEscape} />

<!-- `data-popover` keeps the reader's keyboard shortcuts off while focus is inside the sheet. -->
<aside
  aria-label="Dictionary"
  data-popover
  data-lookup-sheet
  class="sheet"
  class:desktop
  class:open
  class:dragging
  style:transform
  style:height={desktop ? undefined : `${sheetHeight}px`}
  inert={!open}
>
  {#if desktop}
    <button type="button" class="close" aria-label="Close" onclick={onClose}>×</button>
  {:else}
    <button
      type="button"
      class="handle"
      aria-label={expanded ? 'Collapse' : 'Expand'}
      onpointerdown={handlePointerDown}
      onpointermove={handlePointerMove}
      onpointerup={handlePointerUp}
      onpointercancel={handlePointerCancel}
    >
      <span></span>
    </button>
  {/if}

  <div bind:this={scroller} class="scroller" class:scrolls={!compact}>
    <div bind:clientHeight={contentHeight} class="content">
      {#if backLabel !== null}
        <button type="button" class="back" onclick={back}>‹ {backLabel}</button>
      {/if}

      {#if status === 'no-dictionaries'}
        <p class="text-[13px] text-[#9a9a9a]">
          No dictionaries enabled. Add them in Settings &gt; Yomitan.
        </p>
      {:else if status === 'error'}
        <p class="text-[13px] text-[#9a9a9a]">Lookup failed.</p>
      {:else if session}
        {@const { client, box, tokens, glossaryStyle, noteStates, loadKanji } = session}
        {#if view.kind === 'kanji'}
          {#key view.character}
            <KanjiView
              {client}
              character={view.character}
              loadInfo={loadKanji}
              onKanji={openKanji}
              onWord={openTerm}
            />
          {/key}
        {:else if view.kind === 'box'}
          <SentenceStrip
            words={tokens.map(({ text, entries }) => ({ text, matched: entries.length > 0 }))}
            selected={view.wordIndex}
            onSelect={(index) => (history = selectWord(index))}
            onSelectText={openTerm}
          />
          {@const token = view.wordIndex === null ? undefined : tokens[view.wordIndex]}
          {#if token}
            {#await wordEntries(session, token.text, token.entries) then entries}
              <WordView
                {client}
                {entries}
                surface={token.text}
                {compact}
                {glossaryStyle}
                {controller}
                noteContext={noteContextFor(client, box, token.text, token.range.start)}
                {extraMarkers}
                {noteStates}
                onKanji={openKanji}
                onQuery={openTerm}
              />
            {/await}
          {:else}
            <p class="mt-2 text-[13px] text-[#666]">No match</p>
          {/if}
        {:else}
          {#await wordEntries(session, view.query) then entries}
            {#if entries.length > 0}
              <WordView
                {client}
                {entries}
                surface={view.query}
                {compact}
                {glossaryStyle}
                {controller}
                noteContext={noteContextFor(client, box, view.query, box.text.indexOf(view.query))}
                {extraMarkers}
                {noteStates}
                onKanji={openKanji}
                onQuery={openTerm}
              />
            {:else}
              <p class="mt-2 text-[13px] text-[#666]">No match</p>
            {/if}
          {:catch}
            <p class="text-[13px] text-[#9a9a9a]">Lookup failed.</p>
          {/await}
        {/if}
      {/if}
    </div>
  </div>
</aside>

<style>
  .sheet {
    position: fixed;
    z-index: 60;
    display: flex;
    flex-direction: column;
    background: #000;
    color: #fff;
    font-size: 14px;
    transition:
      transform 180ms ease-out,
      visibility 0s linear 180ms;
    visibility: hidden;
    /* Mobile: bottom sheet. */
    right: 0;
    bottom: 0;
    left: 0;
    border-top: 1px solid #222;
    border-radius: 12px 12px 0 0;
    box-shadow: 0 -2px 12px rgba(0, 0, 0, 0.5);
  }

  .sheet.open {
    visibility: visible;
    transition:
      transform 180ms ease-out,
      visibility 0s;
  }

  .sheet.dragging {
    transition: none;
  }

  .sheet.desktop {
    top: 0;
    left: auto;
    width: 420px;
    height: 100dvh;
    border-top: none;
    border-left: 1px solid #222;
    border-radius: 0;
    box-shadow: -2px 0 12px rgba(0, 0, 0, 0.5);
  }

  @media (prefers-reduced-motion: reduce) {
    .sheet,
    .sheet.open {
      transition: none;
    }
  }

  .handle {
    position: relative;
    z-index: 10;
    flex: none;
    height: 28px;
    width: 100%;
    touch-action: none;
    cursor: grab;
  }

  .handle span {
    position: absolute;
    top: 8px;
    left: 50%;
    height: 4px;
    width: 36px;
    transform: translateX(-50%);
    border-radius: 2px;
    background: #444;
  }

  .close {
    position: absolute;
    top: 4px;
    right: 8px;
    z-index: 10;
    height: 36px;
    width: 36px;
    font-size: 24px;
    line-height: 1;
    color: #9a9a9a;
  }

  .close:hover {
    color: #fff;
  }

  .scroller {
    min-height: 0;
    flex: 1;
    overflow: hidden;
    overscroll-behavior: contain;
    touch-action: pan-y;
    user-select: text;
    -webkit-user-select: text;
  }

  .scroller.scrolls {
    overflow-y: auto;
  }

  .content {
    padding: 0 16px calc(16px + env(safe-area-inset-bottom));
  }

  .sheet.desktop .content {
    padding-top: 40px;
  }

  .back {
    margin-bottom: 8px;
    min-height: 32px;
    font-size: 13px;
    color: #9a9a9a;
  }

  .sheet :global([lang='ja']) {
    font-family: 'Noto Sans JP', sans-serif;
  }

  button:focus-visible {
    outline: 1px solid #f5c542;
  }
</style>
