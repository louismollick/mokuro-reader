<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import { createDisplayController, type DisplayController } from 'yomitan-core';
  import type { AnkiNoteContext, SegmentToken, TermDictionaryEntry, Yomitan } from 'yomitan-core';
  import type { VolumeMetadata } from '$lib/anki-connect';
  import type { Rect } from '$lib/panel/yolo';
  import { activeTheme, settings } from '$lib/settings';
  import { getYomitan } from '$lib/yomitan/client';
  import { createMokuroAnkiTransport } from '$lib/yomitan/anki-transport';
  import { buildBoxText, type BoxText } from '$lib/yomitan/box-text';
  import { showHighlight, tapOffset } from '$lib/yomitan/box-dom';
  import {
    createViewLoader,
    warmUpCommonWords,
    type ViewData,
    type ViewLoader
  } from '$lib/yomitan/lookup-loader';
  import type { LookupRequest } from '$lib/yomitan/lookup-request';
  import {
    backTitle,
    currentView,
    popView,
    pushView,
    selectWord,
    startHistory,
    type LookupHistory,
    type LookupView
  } from '$lib/yomitan/lookup-session';
  import { MinedPanels } from '$lib/yomitan/mined-panels.svelte';
  import type { MinedPanel } from '$lib/yomitan/mining';
  import { NoteStates } from '$lib/yomitan/note-states';
  import { profileScreenshotFields, replacePanel } from '$lib/yomitan/panel-adjust';
  import { cropRect } from '$lib/panel/panel-crop';
  import { warmUpPanelDetector } from '$lib/panel/detect-panels';
  import { showSnackbar } from '$lib/util/snackbar';
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
    minedPanels: MinedPanels;
    loader: ViewLoader;
  }

  /** What the sheet shows: a view whose data is fully loaded. */
  interface Shown {
    session: Session;
    history: LookupHistory;
    data: ViewData;
    /** It took long enough to load that it fades in; a cached view swaps at once. */
    fade: boolean;
  }

  // ---- Lookup session --------------------------------------------------------------------

  let status = $state<'loading' | 'ready' | 'no-dictionaries' | 'error'>('loading');
  let session = $state.raw<Session | null>(null);
  /** The history the user asked for; `shown` catches up once its view has loaded. */
  let history = $state.raw<LookupHistory>(startHistory(null));
  let shown = $state.raw<Shown | null>(null);
  let generation = 0;
  /** Segmentation per Text Box text, kept while the sheet stays open on a page. */
  const segmentations = new Map<string, Promise<SegmentToken[]>>();
  /** One loader per client, kept while the sheet stays open, so views are cached across taps. */
  let loaders = new WeakMap<Yomitan, ViewLoader>();

  /** Yomitan's glossary CSS keys its colors off `data-theme`: follow the app theme's base. */
  function glossaryAttributes(client: Yomitan) {
    const base = $activeTheme.base;
    return { ...client.render.attributes(), theme: base, outerTheme: base };
  }

  async function begin(next: LookupRequest) {
    const id = ++generation;
    status = 'loading';
    adjusting = null;
    // The previous view stays on screen (and the sheet where it is) until this one is ready.

    try {
      // Read the tap's geometry before anything async: the page could move meanwhile.
      const box = buildBoxText(next.lines);
      const offset = tapOffset(next.textBox, box, next.lines, next.x, next.y);
      const client = await getYomitan();
      if (id !== generation) return;
      if (!client.profile.get().options.dictionaries.some(({ enabled }) => enabled)) {
        status = 'no-dictionaries';
        shown = null;
        return;
      }
      warmUpCommonWords(client);

      const key = `${next.boxKey}|${box.text}`;
      let segmenting = segmentations.get(key);
      if (!segmenting) {
        segmenting = client.lookup.segment(box.text);
        segmentations.set(key, segmenting);
        segmenting.catch(() => segmentations.delete(key));
      }
      const [tokens, css] = await Promise.all([segmenting, client.render.css()]);
      if (id !== generation) return;

      let loader = loaders.get(client);
      if (!loader) {
        loader = createViewLoader(client);
        loaders.set(client, loader);
      }
      const current: Session = {
        request: next,
        client,
        box,
        tokens,
        glossaryStyle: { css, attributes: glossaryAttributes(client) },
        noteStates: new NoteStates(),
        minedPanels: new MinedPanels(),
        loader
      };
      session = current;
      status = 'ready';
      scrollStack = [];
      navigate(current, startHistory(offset === null ? null : pickWordIndex(tokens, offset)));
    } catch (error) {
      if (id !== generation) return;
      console.error('Tap Lookup failed:', error);
      status = 'error';
      shown = null;
    }
  }

  /** The Word View's lookup text and Segmentation entries for `view`; null for a Kanji View. */
  function viewText(current: Session, view: LookupView) {
    if (view.kind === 'kanji') return null;
    if (view.kind === 'term') return { text: view.query, fallback: undefined };
    const token = view.wordIndex === null ? undefined : current.tokens[view.wordIndex];
    return token ? { text: token.text, fallback: token.entries } : { text: null, fallback: [] };
  }

  /** How long the Anki check may hold a view back, so its button appears in its real state. */
  const NOTE_STATE_GRACE_MS = 300;
  /** Anki checks a view has already waited for. */
  const graced = new WeakSet<Promise<unknown>>();
  /** A view that loads faster than this appears at once, without fading in. */
  const FADE_AFTER_MS = 100;
  let navigation = 0;
  /** The scroll position to restore once the next view shows (going back), else the top. */
  let restoreScroll = 0;

  /**
   * Asks for `next`; the sheet keeps showing the current view until `next` has loaded. Then it
   * scrolls to `scrollTop`, and opens the full sheet if `expand`.
   */
  function navigate(current: Session, next: LookupHistory, { scrollTop = 0, expand = false } = {}) {
    history = next;
    const id = ++navigation;
    const started = performance.now();
    const view = currentView(next);
    const target = viewText(current, view);
    current.loader
      .load(view, target?.text ?? null, target?.fallback)
      .then(async (data) => {
        const active = controllerFor(current);
        if (data.kind === 'word' && active) {
          const context = noteContextFor(
            current,
            target?.text ?? '',
            view.kind === 'box' ? (view.wordIndex ?? undefined) : undefined
          );
          // The first entry is the one in view; the others ask Anki when they appear. A check
          // gets its grace once: a hung Anki must not hold back every later view.
          const states = data.entries
            .slice(0, 1)
            .map((entry) => current.noteStates.get(active, entry, context, extraMarkers))
            .filter((state) => !graced.has(state));
          states.forEach((state) => graced.add(state));
          if (states.length > 0) {
            await Promise.race([
              Promise.allSettled(states),
              new Promise((resolve) => setTimeout(resolve, NOTE_STATE_GRACE_MS))
            ]);
          }
        }
        return data;
      })
      .then(
        (data) => {
          if (id !== navigation) return;
          restoreScroll = scrollTop;
          if (expand && !desktop) expanded = true;
          const fade = performance.now() - started > FADE_AFTER_MS;
          shown = { session: current, history: next, data, fade };
        },
        (error) => {
          if (id !== navigation) return;
          console.error('Lookup view failed to load:', error);
          // Stay on the view that is showing (with its back button); asking again retries.
          if (shown?.session === current) {
            history = shown.history;
            showSnackbar('Lookup failed.');
          } else {
            status = 'error';
            shown = null;
          }
        }
      );
  }

  $effect(() => {
    if (!request) {
      segmentations.clear();
      loaders = new WeakMap();
      generation++;
      navigation++;
      session = null;
      shown = null;
      history = startHistory(null);
      expanded = false;
      return;
    }
    untrack(() => void begin(request));
  });

  /** Still loading what the user asked for (a new tap, or a view not yet shown). */
  let loading = $derived(
    status === 'loading' || (status === 'ready' && shown?.history !== history)
  );
  let view = $derived(shown ? currentView(shown.history) : null);
  let backLabel = $derived(
    shown ? backTitle(shown.history, (index) => shown?.session.tokens[index]?.text) : null
  );
  /** The strip follows the user's choice at once; the entries below follow when loaded. */
  let stripSelected = $derived.by(() => {
    const asked = currentView(history);
    if (asked.kind === 'box') return asked.wordIndex;
    return view?.kind === 'box' ? view.wordIndex : null;
  });

  // ---- Page highlight --------------------------------------------------------------------

  // The Word the Text Box's own view is on stays marked on the page while the sheet is open.
  $effect(() => {
    const root = history[0];
    if (!request || !session || root.kind !== 'box' || root.wordIndex === null) return;
    const token = session.tokens[root.wordIndex];
    if (!token) return;
    return showHighlight(
      session.request.textBox,
      session.box.spans(token.range.start, token.range.end)
    );
  });

  // ---- Panel Crop ------------------------------------------------------------------------

  // Load the panel model in idle time so the first Mining isn't slowed by it.
  $effect(() => {
    if (request && ankiEnabled) warmUpPanelDetector();
  });

  /** The Word whose Panel Crop the user is adjusting. */
  let adjusting = $state.raw<{ entry: TermDictionaryEntry; panel: MinedPanel } | null>(null);

  /** Re-cuts the Panel Crop at `rect` and puts it on the note, then updates the thumbnail. */
  async function adjustPanel(rect: Rect) {
    const current = session;
    const target = adjusting;
    adjusting = null;
    if (!current || !target) return;
    const { panel, entry } = target;
    try {
      const fields = profileScreenshotFields(current.client, panel.cardFormatIndex);
      const image = await cropRect(panel.source.pageImage, rect);
      const fileName = await replacePanel(panel.noteId, fields, panel.fileName, image);
      if (fileName) {
        current.minedPanels.set(entry, { ...panel, fileName, rect, image });
        showSnackbar('Updated the Panel Crop.');
        return;
      }
    } catch (error) {
      console.error('Panel Crop update failed:', error);
    }
    showSnackbar('Could not update the Panel Crop.');
  }

  // ---- Views -----------------------------------------------------------------------------

  /** The Sentence and page details Anki notes get for `query`, found in the Text Box if it is there. */
  function noteContextFor({ client, box, tokens }: Session, query: string, wordIndex?: number) {
    const token = wordIndex === undefined ? undefined : tokens[wordIndex];
    const start = token?.text === query ? token.range.start : box.text.indexOf(query);
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
  /** Each session's display controller, made again when the connection settings change. */
  let controllers = $derived.by(() => {
    void ankiTransportKey;
    void volumeMetadata;
    return new WeakMap<Session, DisplayController>();
  });

  /** The Anki controller of `current` (its Panel Crops are recorded to its session); null when off. */
  function controllerFor(current: Session): DisplayController | null {
    if (!ankiEnabled) return null;
    let controller = controllers.get(current);
    if (!controller) {
      const { client, minedPanels } = current;
      controller = createDisplayController(client, {
        anki: createMokuroAnkiTransport(volumeMetadata, (fileName, source) =>
          minedPanels.screenshots.record(fileName, source)
        )
      });
      controllers.set(current, controller);
    }
    return controller;
  }
  let extraMarkers = $derived({
    series: volumeMetadata?.seriesTitle ?? '',
    volume: volumeMetadata?.volumeTitle ?? ''
  });

  /** Scroll positions of the views under the current one, restored on the way back. */
  let scrollStack: number[] = [];

  /**
   * The view on screen, made the current one: controls act on what the user sees. If a new Tap
   * Lookup is still loading behind it, the user moved on from that tap, so it is dropped.
   */
  function displayed(): Shown | null {
    if (!shown) return null;
    if (session !== shown.session || status !== 'ready') {
      generation++;
      session = shown.session;
      status = 'ready';
    }
    return shown;
  }

  function push(next: LookupView, expand = false) {
    const current = displayed();
    if (!current) return;
    const depth = current.history.length;
    scrollStack = [...scrollStack.slice(0, depth - 1), scroller?.scrollTop ?? 0];
    navigate(current.session, pushView(current.history, next), { expand });
  }

  function openKanji(character: string) {
    // A Kanji View is taller than the peek: it opens the full sheet once it shows.
    push({ kind: 'kanji', character }, true);
  }

  function selectBoxWord(index: number) {
    const current = displayed();
    if (!current) return;
    scrollStack = [];
    navigate(current.session, selectWord(index));
  }

  function startAdjust(minedPanels: MinedPanels, entry: TermDictionaryEntry) {
    const panel = minedPanels.get(entry);
    if (panel) adjusting = { entry, panel };
  }

  function openTerm(query: string) {
    push({ kind: 'term', query });
  }

  function back() {
    const current = displayed();
    if (!current) return;
    const next = popView(current.history);
    navigate(current.session, next, { scrollTop: scrollStack[next.length - 1] ?? 0 });
  }

  // ---- Sheet geometry and drag -----------------------------------------------------------

  const DESKTOP_MIN_WIDTH = 768;
  const HANDLE_HEIGHT = 28;
  const MIN_PEEK = 168;
  /** The peek never covers more of the viewport than this; past it, the peek scrolls. */
  const MAX_PEEK_SHARE = 0.6;

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

  /** How long a first Tap Lookup may take before the sheet slides in without its content. */
  const OPEN_EMPTY_AFTER_MS = 300;

  /**
   * Mounted closed, then slides in once the first view is ready (laid out, so the peek has its
   * height), or after `OPEN_EMPTY_AFTER_MS` with the loading bar. Once open, later taps only swap
   * the content.
   */
  let open = $state(false);
  /** When the sheet was asked to open: the empty-open deadline counts from here. */
  let openRequestedAt: number | null = null;
  $effect(() => {
    if (!request) {
      open = false;
      openRequestedAt = null;
      return;
    }
    if (untrack(() => open)) return;
    openRequestedAt ??= performance.now();
    if (shown === null && (status === 'loading' || status === 'ready')) {
      const left = OPEN_EMPTY_AFTER_MS - (performance.now() - openRequestedAt);
      const timer = setTimeout(() => (open = true), Math.max(0, left));
      return () => clearTimeout(timer);
    }
    // Two frames: the content's height is measured (ResizeObserver) between them.
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => (open = true));
    });
    return () => cancelAnimationFrame(frame);
  });

  let expanded = $state(false);
  let contentHeight = $state(0);
  let dragDy = $state(0);
  let dragging = $state(false);

  let sheetHeight = $derived(Math.round(viewportHeight * 0.92));

  /**
   * Fits the peek's content: the Sentence, the headword and the first sense of the first
   * dictionary (Glossary cuts there). It only grows while the sheet stays open, so a new tap or
   * another Word in the strip changes the content without moving the sheet; it starts over when
   * the sheet closes.
   */
  let peekHeight = $state(MIN_PEEK);
  $effect(() => {
    if (!request) {
      peekHeight = MIN_PEEK;
      return;
    }
    if (!compact || !shown) return;
    const fit = Math.round(Math.max(contentHeight + HANDLE_HEIGHT, MIN_PEEK));
    if (fit > untrack(() => peekHeight)) peekHeight = fit;
  });
  /** The peek as shown: capped by the current viewport, so a rotation or keyboard can't break it. */
  let visiblePeek = $derived(Math.round(Math.min(peekHeight, viewportHeight * MAX_PEEK_SHARE)));
  let transform = $derived.by(() => {
    if (desktop) return `translateX(${open ? 0 : 100}%)`;
    const rest = !open ? sheetHeight + 24 : expanded ? 0 : sheetHeight - visiblePeek;
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
    if (adjusting) adjusting = null;
    else onClose();
  }

  let scroller: HTMLDivElement | undefined = $state();
  // A newly shown view starts at the top, or where it was left when going back.
  $effect(() => {
    void shown;
    scroller?.scrollTo(
      0,
      untrack(() => restoreScroll)
    );
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

  <div class="progress" class:active={loading} aria-hidden="true"></div>

  <!-- Collapsed, only the peek is on screen: the scroller ends there so all of it can scroll in. -->
  <div
    bind:this={scroller}
    class="scroller"
    style:max-height={compact && !dragging ? `${visiblePeek - HANDLE_HEIGHT}px` : undefined}
    aria-busy={loading}
  >
    <div bind:clientHeight={contentHeight} class="content">
      {#if status === 'no-dictionaries'}
        <p class="text-[13px] text-gray-400">
          No dictionaries enabled. Add them in Settings &gt; Yomitan.
        </p>
      {:else if status === 'error'}
        <p class="text-[13px] text-gray-400">Lookup failed.</p>
      {:else if shown && view}
        {@const { session: current, data } = shown}
        {@const { client, tokens, glossaryStyle, noteStates, minedPanels } = current}
        {#if backLabel !== null}
          <button type="button" class="back" onclick={back}>‹ {backLabel}</button>
        {/if}
        {#if view.kind === 'box'}
          <SentenceStrip
            words={tokens.map(({ text, entries }) => ({ text, matched: entries.length > 0 }))}
            selected={stripSelected}
            onSelect={selectBoxWord}
            onSelectText={openTerm}
          />
        {/if}
        <!-- Keyed by the shown view so each one fades in whole, never section by section. -->
        {#key data}
          <div class="view" class:fade={shown.fade}>
            {#if data.kind === 'kanji'}
              <KanjiView {data} onKanji={openKanji} onWord={openTerm} />
            {:else if data.entries.length > 0}
              {@const query =
                view.kind === 'term'
                  ? view.query
                  : view.kind === 'box' && view.wordIndex !== null
                    ? (tokens[view.wordIndex]?.text ?? '')
                    : ''}
              <WordView
                {client}
                entries={data.entries}
                glossaries={data.glossaries}
                surface={query}
                {compact}
                {glossaryStyle}
                controller={controllerFor(current)}
                noteContext={noteContextFor(
                  current,
                  query,
                  view.kind === 'box' ? (view.wordIndex ?? undefined) : undefined
                )}
                {extraMarkers}
                {noteStates}
                panelSource={current.request.panel}
                {minedPanels}
                onAdjust={(entry) => startAdjust(minedPanels, entry)}
                onKanji={openKanji}
                onQuery={openTerm}
              />
            {:else}
              <p class="mt-2 text-[13px] text-gray-500">No match</p>
            {/if}
          </div>
        {/key}
      {/if}
    </div>
  </div>
</aside>

{#if adjusting}
  {#await import('./PanelAdjust.svelte') then { default: PanelAdjust }}
    <PanelAdjust
      image={adjusting.panel.source.pageImage}
      rect={adjusting.panel.rect}
      onConfirm={adjustPanel}
      onCancel={() => (adjusting = null)}
    />
  {/await}
{/if}

<style>
  .sheet {
    position: fixed;
    z-index: 60;
    display: flex;
    flex-direction: column;
    /* The theme's surface, as the app's other drawers and menus. */
    background: var(--color-gray-800, #1f2937);
    color: var(--color-white, #fff);
    font-size: 14px;
    transition:
      transform 180ms ease-out,
      visibility 0s linear 180ms;
    visibility: hidden;
    /* Mobile: bottom sheet. */
    right: 0;
    bottom: 0;
    left: 0;
    border-top: 1px solid var(--color-gray-700, #374151);
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
    border-left: 1px solid var(--color-gray-700, #374151);
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
    background: var(--color-gray-600, #4b5563);
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
    color: var(--color-gray-400, #9ca3af);
  }

  .close:hover {
    color: var(--color-white, #fff);
  }

  /* Shows only when a view takes a moment to load: a quick one swaps without it. */
  .progress {
    position: relative;
    z-index: 10;
    flex: none;
    height: 2px;
    margin-top: -2px;
    overflow: hidden;
    opacity: 0;
  }

  .progress.active {
    animation: progress-in 0s linear 150ms forwards;
  }

  .progress.active::after {
    content: '';
    position: absolute;
    inset: 0 auto 0 0;
    width: 30%;
    background: var(--color-primary-500, #fe795d);
    animation: progress-slide 1s ease-in-out infinite;
  }

  @keyframes progress-in {
    to {
      opacity: 1;
    }
  }

  @keyframes progress-slide {
    from {
      transform: translateX(-100%);
    }
    to {
      transform: translateX(340%);
    }
  }

  .view.fade {
    animation: view-in 120ms ease-out;
  }

  @keyframes view-in {
    from {
      opacity: 0;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .view,
    .progress.active::after {
      animation: none;
    }
  }

  .scroller {
    min-height: 0;
    flex: 1;
    overflow-y: auto;
    overscroll-behavior: contain;
    touch-action: pan-y;
    user-select: text;
    -webkit-user-select: text;
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
    color: var(--color-gray-400, #9ca3af);
  }

  .sheet :global([lang='ja']) {
    font-family: 'Noto Sans JP', sans-serif;
  }

  button:focus-visible {
    outline: 1px solid var(--color-primary-500, #fe795d);
  }
</style>
