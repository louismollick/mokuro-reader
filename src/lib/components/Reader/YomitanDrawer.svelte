<script lang="ts">
  import { Button, Drawer } from 'flowbite-svelte';
  import { ArrowLeftOutline, BookOpenSolid } from 'flowbite-svelte-icons';
  import { sineIn } from 'svelte/easing';
  import type { KanjiDictionaryEntry, TermDictionaryEntry } from 'yomitan-core';
  import type { VolumeMetadata } from '$lib/anki-connect';
  import {
    buildEnabledKanjiDictionaryMap,
    buildEnabledDictionaryMap,
    getInstalledDictionaries,
    lookupKanji,
    lookupTerm,
    tokenizeText,
    type YomitanDictionarySummary,
    type YomitanToken
  } from '$lib/yomitan/core';
  import {
    type DrawerSearchView,
    type DrawerSelectionOrigin,
    type DrawerSelectionState,
    type DrawerTermView,
    normalizeDrawerSelectionText,
    isJapaneseSelection,
    getSelectionCodePointLength
  } from '$lib/yomitan/drawer-state';
  import type { YomitanAnkiButtonUiState } from '$lib/yomitan/anki-button-ui';
  import {
    buildYomitanDebugSnapshot,
    copyTextToClipboard,
    getCodePointPreview,
    isYomitanDebugEnabled,
    logYomitanDebug
  } from '$lib/yomitan/debug';
  import {
    loadDictionaryPreferences,
    normalizeDictionaryPreferences,
    saveDictionaryPreferences
  } from '$lib/yomitan/preferences';
  import { addPopupAnkiNote, getPopupAnkiButtonStates } from '$lib/yomitan/anki-note';
  import { showSnackbar } from '$lib/util/snackbar';
  import YomitanKanjiResults from './YomitanKanjiResults.svelte';
  import YomitanResults from './YomitanResults.svelte';

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

  let dictionaries = $state<YomitanDictionarySummary[]>([]);
  let tokens = $state<YomitanToken[]>([]);
  let selectedTokenIndex = $state<number | null>(null);
  let loading = $state(false);
  let lookupLoading = $state(false);
  let errorMessage = $state('');
  let noticeMessage = $state('');
  let selectionMessage = $state('');
  let currentSelection = $state<DrawerSelectionState | null>(null);
  let viewStack = $state<DrawerSearchView[]>([]);
  let navigationRequestId = $state(0);
  let viewIdCounter = $state(0);
  let ankiPrecheckWarningShown = $state(false);
  let drawerPanel: HTMLElement | null = $state(null);
  let tokenSelectionRoot: HTMLElement | null = $state(null);
  let resultsSelectionRoot: HTMLElement | null = $state(null);
  let debugEnabled = $state(false);
  let currentView = $derived.by(() => viewStack.at(-1) ?? null);
  let canGoBack = $derived(viewStack.length > 1);
  let noEntries = $derived(currentView?.kind === 'term' && currentView.entries.length === 0);
  let emptyResultMessage = $derived.by(() => {
    if (currentView?.kind === 'term' && currentView.query) {
      return `No dictionary entries found for "${currentView.query}".`;
    }

    return 'No dictionary entries found for this token.';
  });
  const transitionParams = {
    y: 320,
    duration: 200,
    easing: sineIn
  };

  function debugYomitan(message: string, details?: Record<string, unknown>) {
    logYomitanDebug('drawer', message, details);
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
    dictionaries = [];
    tokens = [];
    selectedTokenIndex = null;
    errorMessage = '';
    noticeMessage = '';
    selectionMessage = '';
    loading = false;
    lookupLoading = false;
    currentSelection = null;
    viewStack = [];
    navigationRequestId = 0;
    viewIdCounter = 0;
    ankiPrecheckWarningShown = false;
    clearNativeSelection();
  }

  function beginNavigation() {
    navigationRequestId += 1;
    lookupLoading = true;
    noticeMessage = '';
    selectionMessage = '';
    ankiPrecheckWarningShown = false;
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

  function updateTermView(
    viewId: number,
    updater: (view: DrawerTermView) => DrawerTermView
  ): boolean {
    let updated = false;

    viewStack = viewStack.map((view) => {
      if (view.kind !== 'term' || view.id !== viewId) {
        return view;
      }

      updated = true;
      return updater(view);
    });

    return updated;
  }

  function hasTermView(viewId: number): boolean {
    return viewStack.some((view) => view.kind === 'term' && view.id === viewId);
  }

  function resolveSelectionOrigin(node: Node | null): DrawerSelectionOrigin | null {
    if (!node) return null;
    const element = node instanceof Element ? node : node.parentElement;
    if (!element) return null;
    if (tokenSelectionRoot?.contains(element)) return 'tokens';
    if (resultsSelectionRoot?.contains(element)) return 'results';
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
      ui: {
        title: params.query,
        backLabel: getBackLabel(params.previousView)
      },
      ankiButtonStates: ankiEnabled ? params.entries.map(() => ({ state: 'ready' })) : [],
      ankiButtonChecked: ankiEnabled ? params.entries.map(() => false) : [],
      ankiButtonFadeIn: ankiEnabled ? params.entries.map(() => false) : []
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

  async function copyDebugSnapshot() {
    try {
      const activeTermView = getActiveTermView();
      const snapshot = buildYomitanDebugSnapshot({
        drawer: {
          open,
          loading,
          lookupLoading,
          tokenCount: tokens.length,
          selectableCount: tokens.filter((token) => token.selectable).length,
          selectedTokenIndex,
          currentViewKind: currentView?.kind ?? null,
          stackDepth: viewStack.length,
          currentQuery: currentView?.query ?? '',
          activeTermQuery: activeTermView?.query ?? '',
          termEntryCount: activeTermView?.entries.length ?? 0,
          kanjiEntryCount: currentView?.kind === 'kanji' ? currentView.entries.length : 0,
          noEntries,
          noticeMessage,
          errorMessage,
          sourceTextLength: sourceText.length,
          sourceTextPreview: sourceText.slice(0, 120),
          sourceTextCodePoints: getCodePointPreview(sourceText),
          selectionText: currentSelection?.text ?? '',
          selectionOrigin: currentSelection?.origin ?? null,
          dictionaryCount: dictionaries.length,
          dictionaryTitles: dictionaries.map((item) => item.title)
        }
      });

      await copyTextToClipboard(snapshot);
      showSnackbar('Copied Yomitan debug snapshot.');
    } catch (error) {
      console.error('Failed to copy Yomitan debug snapshot:', error);
      showSnackbar('Failed to copy Yomitan debug snapshot.');
    }
  }

  async function handleAddToAnki(entryIndex: number) {
    if (!ankiEnabled) {
      showSnackbar('Enable Anki integration in settings first.');
      return;
    }

    if (currentView?.kind !== 'term') return;

    const entry = currentView.entries[entryIndex];
    if (!entry) return;

    await updateAnkiButtonState(currentView.id, entryIndex, { state: 'adding' });
    try {
      const source = currentView.popupSourceText || currentView.rootSourceText;
      const result = await addPopupAnkiNote(entry, source, volumeMetadata);
      if (result.noteId) {
        await updateAnkiButtonState(currentView.id, entryIndex, { state: 'added' });
        showSnackbar('Added note to Anki.');
      } else {
        await updateAnkiButtonState(currentView.id, entryIndex, { state: 'error' });
        showSnackbar('Failed to add note to Anki.');
      }
    } catch (error) {
      console.error('Failed to add Yomitan note to Anki:', error);
      await updateAnkiButtonState(currentView.id, entryIndex, { state: 'error' });
      const message = error instanceof Error ? error.message : String(error);
      showSnackbar(`Failed to add note: ${message}`);
    }
  }

  function showAnkiButtonsAfterPrecheck(viewId: number, states: YomitanAnkiButtonUiState[]) {
    updateTermView(viewId, (view) => ({
      ...view,
      ankiButtonStates: states,
      ankiButtonChecked: states.map(() => true),
      ankiButtonFadeIn: states.map(() => true)
    }));

    requestAnimationFrame(() => {
      updateTermView(viewId, (view) => ({
        ...view,
        ankiButtonFadeIn: states.map(() => false)
      }));
    });
  }

  async function precheckAnkiButtonStates(
    viewId: number,
    entries: TermDictionaryEntry[],
    tokenText: string,
    fallbackSourceText: string
  ) {
    try {
      const source = tokenText || fallbackSourceText;
      const result = await getPopupAnkiButtonStates(entries, source, volumeMetadata);
      if (!hasTermView(viewId)) return;

      showAnkiButtonsAfterPrecheck(viewId, result.buttonStates);

      if (result.hadConnectionError && !ankiPrecheckWarningShown) {
        ankiPrecheckWarningShown = true;
        showSnackbar('Could not verify duplicates in Anki. You can still add cards.');
      }
    } catch (error) {
      if (!hasTermView(viewId)) return;
      console.error('Failed to precheck Yomitan entries in Anki:', error);
      showAnkiButtonsAfterPrecheck(
        viewId,
        entries.map(() => ({
          state: 'ready',
          title: 'Could not verify duplicates; add may create a duplicate.'
        }))
      );
      if (!ankiPrecheckWarningShown) {
        ankiPrecheckWarningShown = true;
        showSnackbar('Could not verify duplicates in Anki. You can still add cards.');
      }
    }
  }

  async function updateAnkiButtonState(
    viewId: number,
    entryIndex: number,
    nextState: YomitanAnkiButtonUiState
  ) {
    updateTermView(viewId, (view) => {
      if (entryIndex < 0 || entryIndex >= view.ankiButtonStates.length) {
        return view;
      }

      return {
        ...view,
        ankiButtonStates: view.ankiButtonStates.map((state, index) =>
          index === entryIndex ? nextState : state
        ),
        ankiButtonChecked: view.ankiButtonChecked.map((checked, index) =>
          index === entryIndex ? true : checked
        ),
        ankiButtonFadeIn: view.ankiButtonFadeIn.map((fadeIn, index) =>
          index === entryIndex ? false : fadeIn
        )
      };
    });
  }

  async function runTermLookup(params: {
    query: string;
    tokenIndex: number | null;
    popupSourceText: string;
    rootSourceText: string;
    mode: 'replace-active-term' | 'push';
    pushOnEmpty?: boolean;
  }): Promise<{ foundEntries: boolean; viewId: number | null }> {
    const requestId = beginNavigation();

    try {
      const normalizedPreferences = normalizeDictionaryPreferences(
        dictionaries.map((item) => item.title),
        loadDictionaryPreferences()
      );
      const enabledMap = buildEnabledDictionaryMap(normalizedPreferences);
      debugYomitan('lookup:start', {
        tokenText: params.query,
        tokenIndex: params.tokenIndex,
        enabledDictionaryCount: enabledMap.size,
        mode: params.mode
      });

      const lookup = await lookupTerm(params.query, enabledMap);
      if (!isActiveNavigation(requestId)) {
        return { foundEntries: false, viewId: null };
      }

      const previousView = currentView;
      const nextView = buildTermView({
        query: params.query,
        entries: lookup.entries,
        popupSourceText: params.popupSourceText,
        rootSourceText: params.rootSourceText,
        tokenIndex: params.tokenIndex,
        previousView
      });

      debugYomitan('lookup:complete', {
        tokenText: params.query,
        entryCount: lookup.entries.length,
        originalTextLength: lookup.originalTextLength,
        mode: params.mode
      });

      if (!lookup.entries.length && params.pushOnEmpty === false) {
        return { foundEntries: false, viewId: null };
      }

      if (params.mode === 'push') {
        pushView(nextView);
      } else {
        replaceActiveTermView(nextView);
      }

      if (ankiEnabled && lookup.entries.length > 0) {
        void precheckAnkiButtonStates(
          nextView.id,
          lookup.entries,
          params.popupSourceText,
          params.rootSourceText
        );
      }
      return { foundEntries: lookup.entries.length > 0, viewId: nextView.id };
    } catch (error) {
      console.error('Yomitan lookup failed:', error);
      debugYomitan('lookup:failed', {
        tokenText: params.query,
        error: error instanceof Error ? error.message : String(error)
      });
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
    const requestId = beginNavigation();

    try {
      const normalizedPreferences = normalizeDictionaryPreferences(
        dictionaries.map((item) => item.title),
        loadDictionaryPreferences()
      );
      const enabledMap = buildEnabledKanjiDictionaryMap(normalizedPreferences, dictionaries);
      debugYomitan('lookup:kanji-start', {
        character: params.query,
        enabledDictionaryCount: enabledMap.size,
        mode: params.mode
      });

      if (enabledMap.size === 0) {
        noticeMessage = 'No enabled kanji dictionaries.';
        return false;
      }

      const entries = await lookupKanji(params.query, enabledMap);
      if (!isActiveNavigation(requestId)) {
        return false;
      }

      debugYomitan('lookup:kanji-complete', {
        character: params.query,
        entryCount: entries.length
      });

      if (entries.length === 0) {
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
      debugYomitan('lookup:kanji-failed', {
        character: params.query,
        error: error instanceof Error ? error.message : String(error)
      });
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
    debugYomitan('load:start', {
      sourceTextLength: sourceText.length,
      sourceTextPreview: sourceText.slice(0, 120),
      sourceTextCodePoints: getCodePointPreview(sourceText),
      trimmedLength: text.length,
      trimmedPreview: text.slice(0, 120),
      trimmedCodePoints: getCodePointPreview(text)
    });

    if (!text) {
      errorMessage = 'No text found for this box.';
      debugYomitan('load:empty-text', { sourceText });
      return;
    }

    loading = true;
    errorMessage = '';

    try {
      dictionaries = await getInstalledDictionaries();
      debugYomitan('load:dictionaries', {
        dictionaryCount: dictionaries.length,
        dictionaryTitles: dictionaries.map((item) => item.title)
      });
      if (dictionaries.length === 0) {
        errorMessage = 'No Yomitan dictionaries installed. Add dictionaries in Settings > Yomitan.';
        return;
      }

      const normalizedPreferences = normalizeDictionaryPreferences(
        dictionaries.map((item) => item.title),
        loadDictionaryPreferences()
      );
      saveDictionaryPreferences(normalizedPreferences);

      const enabledMap = buildEnabledDictionaryMap(normalizedPreferences);
      debugYomitan('load:dictionary-preferences', {
        normalizedPreferences,
        enabledDictionaryCount: enabledMap.size
      });
      if (enabledMap.size === 0) {
        errorMessage = 'All dictionaries are disabled. Enable at least one in Settings > Yomitan.';
        return;
      }

      tokens = await tokenizeText(text, enabledMap);
      debugYomitan('load:tokenize-complete', {
        tokenCount: tokens.length,
        selectableCount: tokens.filter((token) => token.selectable).length,
        tokenPreview: tokens.slice(0, 10).map((token) => ({
          text: token.text,
          selectable: token.selectable,
          reading: token.reading
        }))
      });
      if (tokens.length === 0) {
        errorMessage = 'No tokens found for this text.';
        return;
      }

      const firstSelectableTokenIndex = tokens.findIndex((token) => token.selectable);
      if (firstSelectableTokenIndex >= 0) {
        const firstToken = tokens[firstSelectableTokenIndex];
        if (firstToken) {
          await handleTokenClick(firstToken, firstSelectableTokenIndex);
        }
      } else {
        selectionMessage = 'No selectable words found for this text.';
      }
    } catch (error) {
      console.error('Yomitan tokenization failed:', error);
      debugYomitan('load:tokenization-failed', {
        error: error instanceof Error ? error.message : String(error)
      });
      errorMessage = 'Failed to initialize Yomitan.';
    } finally {
      loading = false;
    }
  }

  async function handleTokenClick(token: YomitanToken, index: number) {
    if (!token.selectable) return;

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
    await runTermLookup({
      query: token.text,
      tokenIndex: index,
      popupSourceText: token.text,
      rootSourceText: getRootSourceText(),
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

  async function handleSearchSelection() {
    if (!currentSelection) return;

    const selection = currentSelection.text;
    const previousView = currentView;
    const termResult = await runTermLookup({
      query: selection,
      tokenIndex: null,
      popupSourceText: selection,
      rootSourceText: previousView?.rootSourceText || getRootSourceText(),
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

    debugEnabled = isYomitanDebugEnabled();
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
      {#if debugEnabled}
        <div class="mb-4 flex justify-end">
          <Button
            outline
            color="light"
            class="pointer-events-auto !bg-gray-900/80 !text-gray-100 backdrop-blur-sm"
            onclick={copyDebugSnapshot}>Copy debug snapshot</Button
          >
        </div>
      {/if}
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
                {#if token.selectable}
                  <button
                    type="button"
                    class={`inline appearance-none rounded-sm border-0 bg-transparent px-0.5 py-0 text-[1.05rem] leading-8 text-gray-100 underline underline-offset-3 transition-colors select-text hover:text-white hover:decoration-gray-300 focus-visible:outline focus-visible:outline-1 focus-visible:outline-primary-500 ${selectedTokenIndex === index ? 'bg-gray-700/70 decoration-primary-400' : 'decoration-gray-500/70'}`}
                    onclick={() => handleTokenClick(token, index)}
                  >
                    {token.text}
                  </button>
                {:else}
                  <span class="px-0.5 py-0 text-[1.05rem] leading-8 text-gray-200"
                    >{token.text}</span
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
        {:else if currentView?.kind === 'kanji' && currentView.entries.length > 0}
          <div
            bind:this={resultsSelectionRoot}
            class="fade-in h-full overflow-x-hidden overflow-y-auto"
          >
            <YomitanKanjiResults
              entries={currentView.entries}
              dictionaryInfo={dictionaries}
              theme="dark"
            />
          </div>
        {:else if currentView?.kind === 'term' && currentView.entries.length > 0}
          <div
            bind:this={resultsSelectionRoot}
            class="fade-in h-full overflow-x-hidden overflow-y-auto"
          >
            <YomitanResults
              entries={currentView.entries}
              dictionaryInfo={dictionaries}
              theme="dark"
              {ankiEnabled}
              ankiButtonStates={currentView.ankiButtonStates}
              ankiButtonChecked={currentView.ankiButtonChecked}
              ankiButtonFadeIn={currentView.ankiButtonFadeIn}
              onAddToAnki={(entryIndex) => {
                void handleAddToAnki(entryIndex);
              }}
              onKanjiClick={(character) => {
                void handleKanjiClick(character);
              }}
            />
          </div>
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
