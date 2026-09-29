<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { Button, Drawer } from 'flowbite-svelte';
  import { ArrowLeftOutline, BookOpenSolid } from 'flowbite-svelte-icons';
  import { sineIn } from 'svelte/easing';
  import {
    createDisplayController,
    type KanjiDictionaryEntry,
    type ParseToken,
    type Sentence,
    type TermDictionaryEntry,
    type Yomitan
  } from 'yomitan-core';
  import { defineYomitanEntries, type YomitanEntriesElement } from '@yomitan-core/web';
  import { syncAnkiWeb, type VolumeMetadata } from '$lib/anki-connect';
  import { settings } from '$lib/settings';
  import { getYomitan } from '$lib/yomitan/client';
  import { createMokuroAnkiTransport } from '$lib/yomitan/anki-transport';
  import {
    type DrawerSearchView,
    type DrawerSelectionOrigin,
    type DrawerSelectionState,
    type DrawerTermView,
    normalizeDrawerSelectionText,
    isJapaneseSelection,
    getSelectionCodePointLength
  } from '$lib/yomitan/drawer-state';
  import { showSnackbar } from '$lib/util/snackbar';

  interface Props {
    open?: boolean;
    sourceText?: string;
    ankiEnabled?: boolean;
    volumeMetadata?: VolumeMetadata;
    onClose?: () => void;
    outsideClose?: boolean;
    allowSwipeClose?: boolean;
  }

  let {
    open = $bindable(false),
    sourceText = '',
    ankiEnabled = false,
    volumeMetadata,
    onClose,
    outsideClose = true,
    allowSwipeClose: _allowSwipeClose = true
  }: Props = $props();

  let client = $state.raw<Yomitan | null>(null);
  let tokens = $state.raw<ParseToken[]>([]);
  let selectedTokenIndex = $state<number | null>(null);
  let loading = $state(false);
  let lookupLoading = $state(false);
  let errorMessage = $state('');
  let noticeMessage = $state('');
  let selectionMessage = $state('');
  let currentSelection = $state<DrawerSelectionState | null>(null);
  let viewStack = $state.raw<DrawerSearchView[]>([]);
  let navigationRequestId = 0;
  let loadGeneration = 0;
  let viewIdCounter = $state(0);
  let drawerPanel: HTMLElement | null = $state(null);
  let tokenSelectionRoot: HTMLElement | null = $state(null);
  let resultsSelectionRoot: HTMLElement | null = $state(null);
  let entriesElement: YomitanEntriesElement | null = $state.raw(null);
  let currentView = $derived.by(() => viewStack.at(-1) ?? null);
  let canGoBack = $derived(viewStack.length > 1);
  let noEntries = $derived(currentView?.kind === 'term' && currentView.entries.length === 0);
  let emptyResultMessage = $derived.by(() => {
    if (currentView?.kind === 'term' && currentView.query) {
      return `No dictionary entries found for "${currentView.query}".`;
    }

    return 'No dictionary entries found for this token.';
  });

  // Rebuilt whenever the AnkiConnect URL or Android mode changes.
  let ankiTransportKey = $derived(
    [
      $settings.ankiConnectSettings.url,
      $settings.ankiConnectSettings.androidModeOverride,
      $settings.ankiConnectSettings.connectionData?.isAndroid ?? false
    ].join('|')
  );
  let controller = $derived.by(() => {
    void ankiTransportKey;
    if (!ankiEnabled || !client) return null;
    return createDisplayController(client, { anki: createMokuroAnkiTransport() });
  });
  let noteContext = $derived.by(() => {
    const view = currentView?.kind === 'term' ? currentView : null;
    if (!view) return {};
    return {
      sentence: view.sentence,
      url: window.location.href,
      documentTitle: document.title,
      query: view.popupSourceText,
      fullQuery: view.popupSourceText
    };
  });
  let extraMarkers = $derived({
    series: volumeMetadata?.seriesTitle ?? '',
    volume: volumeMetadata?.volumeTitle ?? ''
  });

  const transitionParams = {
    y: 320,
    duration: 200,
    easing: sineIn
  };

  onMount(() => {
    // Client-side only: SvelteKit SSR must not touch `customElements`.
    defineYomitanEntries();
  });

  // The results element is a custom element: hand it data as properties and listen for its events.
  $effect(() => {
    const element = entriesElement;
    const activeClient = client;
    const view = currentView;
    if (!element || !activeClient || !view || view.entries.length === 0) return;

    const onKanjiClick = (event: Event) => {
      void handleKanjiClick((event as CustomEvent<{ character: string }>).detail.character);
    };
    const onLinkClick = (event: Event) => {
      void handleLinkClick((event as CustomEvent<{ query: string }>).detail.query);
    };
    const onNoteAdded = () => {
      void syncAnkiWeb();
      showSnackbar('Added note to Anki.');
    };
    const onNoteError = (event: Event) => {
      const error = (event as CustomEvent<{ error: unknown }>).detail.error;
      console.error('Failed to add Yomitan note to Anki:', error);
      const message = error instanceof Error ? error.message : String(error);
      showSnackbar(`Failed to add note: ${message}`);
    };
    element.addEventListener('kanji-click', onKanjiClick);
    element.addEventListener('link-click', onLinkClick);
    element.addEventListener('note-added', onNoteAdded);
    element.addEventListener('note-error', onNoteError);

    element.client = activeClient;
    element.controller = controller;
    element.extraMarkers = extraMarkers;
    element.noteContext = noteContext;
    // Last: assigning entries triggers the render.
    element.entries = view.entries;

    return () => {
      element.removeEventListener('kanji-click', onKanjiClick);
      element.removeEventListener('link-click', onLinkClick);
      element.removeEventListener('note-added', onNoteAdded);
      element.removeEventListener('note-error', onNoteError);
    };
  });

  function isSelectable(token: ParseToken): boolean {
    return (token.headwords?.length ?? 0) > 0;
  }

  function getRootSourceText(): string {
    return sourceText.trim();
  }

  function getActiveTermView(): DrawerTermView | null {
    for (let index = viewStack.length - 1; index >= 0; index -= 1) {
      const view = viewStack[index];
      if (view?.kind === 'term') {
        return view;
      }
    }

    return null;
  }

  function getBackLabel(previousView: DrawerSearchView | null): string {
    if (!previousView) return 'Back';
    return previousView.query ? `Back to ${previousView.query}` : 'Back';
  }

  function nextViewId(): number {
    viewIdCounter += 1;
    return viewIdCounter;
  }

  function closeDrawer() {
    open = false;
  }

  function preserveSelectionOnButtonPress(event: MouseEvent | PointerEvent) {
    event.preventDefault();
  }

  function clearNativeSelection() {
    window.getSelection()?.removeAllRanges();
    currentSelection = null;
  }

  function handleBackdropMousedown(event: MouseEvent & { currentTarget: HTMLDialogElement }) {
    if (!outsideClose) return;
    if (event.target !== event.currentTarget) return;
    if (!drawerPanel) return;

    const rect = drawerPanel.getBoundingClientRect();
    const clickedInContent =
      event.clientX >= rect.left &&
      event.clientX <= rect.right &&
      event.clientY >= rect.top &&
      event.clientY <= rect.bottom;

    if (!clickedInContent) {
      closeDrawer();
    }
  }

  function resetDrawerState() {
    tokens = [];
    selectedTokenIndex = null;
    errorMessage = '';
    noticeMessage = '';
    selectionMessage = '';
    loading = false;
    lookupLoading = false;
    currentSelection = null;
    viewStack = [];
    // Both counters stay monotonic so results from before a reset are always stale.
    navigationRequestId += 1;
    loadGeneration += 1;
    viewIdCounter = 0;
    clearNativeSelection();
  }

  function beginNavigation() {
    navigationRequestId += 1;
    lookupLoading = true;
    noticeMessage = '';
    selectionMessage = '';
    clearNativeSelection();
    return navigationRequestId;
  }

  function isActiveNavigation(requestId: number): boolean {
    return requestId === navigationRequestId;
  }

  function replaceActiveTermView(view: DrawerTermView) {
    const activeTermView = getActiveTermView();
    if (!activeTermView) {
      viewStack = [view];
      return;
    }

    const activeIndex = viewStack.findIndex((candidate) => candidate.id === activeTermView.id);
    viewStack = [...viewStack.slice(0, activeIndex), view];
  }

  function pushView(view: DrawerSearchView) {
    viewStack = [...viewStack, view];
  }

  function replaceTopView(view: DrawerSearchView) {
    if (viewStack.length === 0) {
      viewStack = [view];
      return;
    }

    viewStack = [...viewStack.slice(0, -1), view];
  }

  function popView() {
    if (viewStack.length <= 1) return;
    viewStack = viewStack.slice(0, -1);
    noticeMessage = '';
    clearNativeSelection();
  }

  /** The origin of a selection node, looking through the results element's shadow root. */
  function resolveSelectionOrigin(node: Node | null): DrawerSelectionOrigin | null {
    let current: Node | null = node;
    while (current) {
      const element: Element | null = current instanceof Element ? current : current.parentElement;
      if (element) {
        if (tokenSelectionRoot?.contains(element)) return 'tokens';
        if (resultsSelectionRoot?.contains(element)) return 'results';
      }
      const root = current.getRootNode();
      current = root instanceof ShadowRoot ? root.host : null;
    }
    return null;
  }

  function recomputeDrawerSelection() {
    if (!open) {
      currentSelection = null;
      return;
    }

    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
      currentSelection = null;
      return;
    }

    const anchorOrigin = resolveSelectionOrigin(selection.anchorNode);
    const focusOrigin = resolveSelectionOrigin(selection.focusNode);
    if (!anchorOrigin || anchorOrigin !== focusOrigin) {
      currentSelection = null;
      return;
    }

    const normalizedText = normalizeDrawerSelectionText(selection.toString());
    if (!normalizedText || !isJapaneseSelection(normalizedText)) {
      currentSelection = null;
      return;
    }

    currentSelection = {
      text: normalizedText,
      origin: anchorOrigin
    };
  }

  function buildTermView(params: {
    query: string;
    entries: TermDictionaryEntry[];
    popupSourceText: string;
    rootSourceText: string;
    tokenIndex: number | null;
    sentence: Sentence;
    previousView: DrawerSearchView | null;
  }): DrawerTermView {
    return {
      id: nextViewId(),
      kind: 'term',
      query: params.query,
      entries: params.entries,
      popupSourceText: params.popupSourceText,
      rootSourceText: params.rootSourceText,
      tokenIndex: params.tokenIndex,
      sentence: params.sentence,
      ui: {
        title: params.query,
        backLabel: getBackLabel(params.previousView)
      }
    };
  }

  function buildKanjiView(params: {
    query: string;
    entries: KanjiDictionaryEntry[];
    popupSourceText: string;
    rootSourceText: string;
    previousView: DrawerSearchView | null;
  }): DrawerSearchView {
    return {
      id: nextViewId(),
      kind: 'kanji',
      query: params.query,
      entries: params.entries,
      popupSourceText: params.popupSourceText,
      rootSourceText: params.rootSourceText,
      ui: {
        title: params.query,
        backLabel: getBackLabel(params.previousView)
      }
    };
  }

  async function runTermLookup(params: {
    query: string;
    tokenIndex: number | null;
    popupSourceText: string;
    rootSourceText: string;
    /** The lookup's range in the root text; defaults to the whole query. */
    sentence: Sentence;
    mode: 'replace-active-term' | 'push';
    pushOnEmpty?: boolean;
  }): Promise<{ foundEntries: boolean; viewId: number | null }> {
    if (!client) return { foundEntries: false, viewId: null };
    const requestId = beginNavigation();

    try {
      const lookup = await client.lookup.terms(params.query);
      if (!isActiveNavigation(requestId)) {
        return { foundEntries: false, viewId: null };
      }

      const nextView = buildTermView({
        query: params.query,
        entries: lookup.entries,
        popupSourceText: params.popupSourceText,
        rootSourceText: params.rootSourceText,
        tokenIndex: params.tokenIndex,
        sentence: params.sentence,
        previousView: currentView
      });

      if (!lookup.entries.length && params.pushOnEmpty === false) {
        return { foundEntries: false, viewId: null };
      }

      if (params.mode === 'push') {
        pushView(nextView);
      } else {
        replaceActiveTermView(nextView);
      }

      return { foundEntries: lookup.entries.length > 0, viewId: nextView.id };
    } catch (error) {
      console.error('Yomitan lookup failed:', error);
      showSnackbar('Failed to look up token in Yomitan.');
      return { foundEntries: false, viewId: null };
    } finally {
      if (isActiveNavigation(requestId)) {
        lookupLoading = false;
      }
    }
  }

  async function runKanjiLookup(params: {
    query: string;
    popupSourceText: string;
    rootSourceText: string;
    mode: 'push' | 'replace-top';
  }): Promise<boolean> {
    if (!client) return false;
    const requestId = beginNavigation();

    try {
      const entries = await client.lookup.kanji(params.query);
      if (!isActiveNavigation(requestId)) {
        return false;
      }

      if (entries.length === 0) {
        noticeMessage = `No kanji dictionary entries found for "${params.query}".`;
        return false;
      }

      const nextView = buildKanjiView({
        query: params.query,
        entries,
        popupSourceText: params.popupSourceText,
        rootSourceText: params.rootSourceText,
        previousView: currentView
      });

      if (params.mode === 'replace-top') {
        replaceTopView(nextView);
      } else {
        pushView(nextView);
      }
      return true;
    } catch (error) {
      console.error('Yomitan kanji lookup failed:', error);
      showSnackbar('Failed to look up kanji in Yomitan.');
      return false;
    } finally {
      if (isActiveNavigation(requestId)) {
        lookupLoading = false;
      }
    }
  }

  async function loadAndTokenizeText() {
    const text = getRootSourceText();

    if (!text) {
      errorMessage = 'No text found for this box.';
      return;
    }

    const generation = ++loadGeneration;
    const isStale = () => generation !== loadGeneration;
    loading = true;
    errorMessage = '';

    try {
      const yomitan = await getYomitan();
      if (isStale()) return;
      client = yomitan;

      const installed = await yomitan.dictionaries.list();
      if (isStale()) return;
      if (installed.length === 0) {
        errorMessage = 'No Yomitan dictionaries installed. Add dictionaries in Settings > Yomitan.';
        return;
      }

      if (!yomitan.profile.get().options.dictionaries.some((dictionary) => dictionary.enabled)) {
        errorMessage = 'All dictionaries are disabled. Enable at least one in Settings > Yomitan.';
        return;
      }

      const parsed = await yomitan.lookup.parse(text);
      if (isStale()) return;
      tokens = parsed;
      if (tokens.length === 0) {
        errorMessage = 'No tokens found for this text.';
        return;
      }

      const firstSelectableTokenIndex = tokens.findIndex(isSelectable);
      if (firstSelectableTokenIndex >= 0) {
        const firstToken = tokens[firstSelectableTokenIndex];
        if (firstToken) {
          await handleTokenClick(firstToken, firstSelectableTokenIndex);
        }
      } else {
        selectionMessage = 'No selectable words found for this text.';
      }
    } catch (error) {
      if (isStale()) return;
      console.error('Yomitan tokenization failed:', error);
      errorMessage = 'Failed to initialize Yomitan.';
    } finally {
      if (!isStale()) loading = false;
    }
  }

  async function handleTokenClick(token: ParseToken, index: number) {
    if (!isSelectable(token) || !client) return;

    const activeTermView = getActiveTermView();
    if (
      currentView?.kind === 'kanji' &&
      activeTermView &&
      activeTermView.tokenIndex === index &&
      activeTermView.query === token.text
    ) {
      const activeIndex = viewStack.findIndex((view) => view.id === activeTermView.id);
      viewStack = viewStack.slice(0, activeIndex + 1);
      noticeMessage = '';
      clearNativeSelection();
      return;
    }

    if (
      currentView?.kind === 'term' &&
      currentView.tokenIndex === index &&
      currentView.query === token.text &&
      !lookupLoading
    ) {
      return;
    }

    selectedTokenIndex = index;
    const rootSourceText = getRootSourceText();
    await runTermLookup({
      query: token.text,
      tokenIndex: index,
      popupSourceText: token.text,
      rootSourceText,
      sentence: client.lookup.sentence(
        rootSourceText,
        token.range.start,
        token.range.end - token.range.start
      ),
      mode: 'replace-active-term'
    });
  }

  async function handleKanjiClick(character: string) {
    const query = character.trim();
    if (!query || currentView?.kind !== 'term') return;

    const resolved = await runKanjiLookup({
      query,
      popupSourceText: currentView.popupSourceText || query,
      rootSourceText: currentView.rootSourceText,
      mode: 'push'
    });

    if (!resolved && !noticeMessage) {
      noticeMessage = `No kanji dictionary entries found for "${query}".`;
    }
  }

  /**
   * The sentence for a query that isn't a token: taken from the text box when the query occurs in
   * it (at `hint` if the selection position is known, else the first occurrence), otherwise from
   * the query alone.
   */
  function sentenceForQuery(query: string, rootText: string, hint?: number): Sentence {
    if (!client) return { text: query, offset: 0 };
    let index = hint !== undefined && rootText.startsWith(query, hint) ? hint : -1;
    if (index < 0) index = rootText.indexOf(query);
    return index >= 0
      ? client.lookup.sentence(rootText, index, query.length)
      : client.lookup.sentence(query, 0, query.length);
  }

  /** The text-box offset of the token holding the start of the native selection, if any. */
  function selectionTokenStart(): number | undefined {
    const selection = window.getSelection();
    const node = selection?.anchorNode;
    const element = node instanceof Element ? node : node?.parentElement;
    const index = Number(element?.closest<HTMLElement>('[data-token-index]')?.dataset.tokenIndex);
    if (!Number.isInteger(index) || !tokens[index]) return undefined;
    // Within one token the offset narrows the position; across tokens the token start is used.
    const within =
      selection && selection.anchorNode === selection.focusNode
        ? Math.min(selection.anchorOffset, selection.focusOffset)
        : 0;
    return tokens[index].range.start + within;
  }

  async function handleLinkClick(query: string) {
    const text = query.trim();
    if (!text) return;

    const rootSourceText = currentView?.rootSourceText || getRootSourceText();
    await runTermLookup({
      query: text,
      tokenIndex: null,
      popupSourceText: text,
      rootSourceText,
      sentence: sentenceForQuery(text, rootSourceText),
      mode: 'push',
      pushOnEmpty: true
    });
  }

  async function handleSearchSelection() {
    if (!currentSelection) return;

    const selection = currentSelection.text;
    const previousView = currentView;
    const rootSourceText = previousView?.rootSourceText || getRootSourceText();
    // A token-bar selection maps onto the text box; use its position when we can.
    let hint: number | undefined;
    if (currentSelection.origin === 'tokens') {
      const start = selectionTokenStart();
      if (start !== undefined) hint = start;
    }
    const termResult = await runTermLookup({
      query: selection,
      tokenIndex: null,
      popupSourceText: selection,
      rootSourceText,
      sentence: sentenceForQuery(selection, rootSourceText, hint),
      mode: 'push',
      pushOnEmpty: true
    });

    if (termResult.foundEntries) {
      return;
    }

    if (getSelectionCodePointLength(selection) === 1) {
      const resolved = await runKanjiLookup({
        query: selection,
        popupSourceText: selection,
        rootSourceText: previousView?.rootSourceText || getRootSourceText(),
        mode: termResult.viewId ? 'replace-top' : 'push'
      });
      if (resolved) return;
    }
  }

  $effect(() => {
    if (!open) {
      resetDrawerState();
      return;
    }

    loadAndTokenizeText();
  });

  $effect(() => {
    if (!open) return;

    const handleSelectionChange = () => {
      recomputeDrawerSelection();
    };

    document.addEventListener('selectionchange', handleSelectionChange);
    return () => {
      document.removeEventListener('selectionchange', handleSelectionChange);
    };
  });

  let wasOpen = $state(open);
  $effect(() => {
    if (wasOpen && !open) {
      onClose?.();
    }
    wasOpen = open;
  });

  onDestroy(() => {
    entriesElement = null;
  });
</script>

<svelte:window
  ondragstart={(event) => {
    if (open) {
      event.preventDefault();
    }
  }}
  onkeydown={(event) => {
    if (open && event.key === 'Escape') {
      closeDrawer();
    }
  }}
/>

<Drawer
  bind:open
  placement="bottom"
  modal={true}
  dismissable={false}
  {transitionParams}
  outsideclose={outsideClose}
  onmousedown={handleBackdropMousedown}
  class="z-[12000] h-dvh w-full max-w-none rounded-none border border-gray-700/80 bg-gray-900 p-0 text-white shadow-2xl md:!mr-auto md:!ml-0 md:!h-[80vh] md:!w-1/2 md:!max-w-[50vw] md:rounded-t-2xl [&::backdrop]:bg-gray-950/35"
>
  <div
    bind:this={drawerPanel}
    data-yomitan-drawer
    class="relative flex h-full min-h-0 w-full flex-col"
  >
    <div
      data-testid="yomitan-top-bar"
      role="group"
      aria-label="Yomitan token bar"
      class="shrink-0 border-b border-gray-800 px-4 pt-4 pb-5"
    >
      <div class="mb-4 flex items-center gap-2">
        <div class="flex min-w-0 items-center gap-2">
          <h2
            class="inline-flex items-center text-base font-semibold text-gray-900 dark:text-white"
          >
            <BookOpenSolid class="mr-2.5 h-4 w-4" />Dictionary
          </h2>
        </div>
        <div class="ml-auto flex items-center gap-2">
          <div class="flex h-8 w-32 shrink-0 items-center justify-end">
            <Button
              size="xs"
              color="alternative"
              class={!currentSelection ? 'pointer-events-none invisible' : ''}
              aria-hidden={!currentSelection}
              disabled={!currentSelection}
              onmousedown={preserveSelectionOnButtonPress}
              onpointerdown={preserveSelectionOnButtonPress}
              onclick={handleSearchSelection}>Search selection</Button
            >
          </div>
          {#if canGoBack}
            <Button
              size="xs"
              color="alternative"
              aria-label={currentView?.ui.backLabel ?? 'Back'}
              onclick={popView}
            >
              <ArrowLeftOutline class="h-3.5 w-3.5" />
            </Button>
          {/if}
          <button
            type="button"
            aria-label="Close"
            class="inline-flex h-8 w-8 items-center justify-center rounded-full text-gray-300 transition hover:bg-gray-800 hover:text-white"
            onclick={closeDrawer}
          >
            <span aria-hidden="true">×</span>
          </button>
        </div>
      </div>
      {#if !loading}
        <section class="fade-in">
          {#if errorMessage}
            <p class="text-sm text-red-300">{errorMessage}</p>
          {:else}
            <div
              bind:this={tokenSelectionRoot}
              class="flex flex-wrap items-end text-gray-100 select-text"
            >
              {#each tokens as token, index (`token-${index}-${token.text}`)}
                {#if isSelectable(token)}
                  <button
                    type="button"
                    data-token-index={index}
                    class={`inline appearance-none rounded-sm border-0 bg-transparent px-0.5 py-0 text-[1.05rem] leading-8 text-gray-100 underline underline-offset-3 transition-colors select-text hover:text-white hover:decoration-gray-300 focus-visible:outline focus-visible:outline-1 focus-visible:outline-primary-500 ${selectedTokenIndex === index ? 'bg-gray-700/70 decoration-primary-400' : 'decoration-gray-500/70'}`}
                    onclick={() => handleTokenClick(token, index)}
                  >
                    {token.text}
                  </button>
                {:else}
                  <span
                    data-token-index={index}
                    class="px-0.5 py-0 text-[1.05rem] leading-8 text-gray-200">{token.text}</span
                  >
                {/if}
              {/each}
            </div>
          {/if}
        </section>
      {/if}
    </div>

    <div class="flex min-h-0 flex-1 flex-col bg-gray-900">
      <section class="relative min-h-0 flex-1 overflow-hidden bg-[#1e1e1e]">
        {#if noticeMessage}
          <div class="border-b border-gray-800 px-5 py-3 text-sm text-yellow-200">
            {noticeMessage}
          </div>
        {/if}
        {#if selectionMessage}
          <div
            class="flex h-full items-center justify-center px-5 text-center text-sm text-gray-600"
          >
            {selectionMessage}
          </div>
        {:else if noEntries}
          <div
            class="flex h-full items-center justify-center px-5 text-center text-sm text-gray-600"
          >
            {emptyResultMessage}
          </div>
        {:else if currentView && currentView.entries.length > 0}
          {#key currentView.id}
            <div
              bind:this={resultsSelectionRoot}
              data-testid="yomitan-results"
              class="fade-in h-full overflow-x-hidden overflow-y-auto"
            >
              <yomitan-entries bind:this={entriesElement}></yomitan-entries>
            </div>
          {/key}
        {/if}

        {#if lookupLoading}
          <div class="absolute inset-0 bg-[#1e1e1e]"></div>
        {/if}
      </section>
    </div>
  </div>
</Drawer>

<style>
  .fade-in {
    animation: yomitan-fade-in 240ms ease-out;
  }

  @keyframes yomitan-fade-in {
    from {
      opacity: 0;
    }

    to {
      opacity: 1;
    }
  }
</style>
