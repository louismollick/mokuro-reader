<script lang="ts">
  import { Button } from 'flowbite-svelte';
  import * as Drawer from '$lib/components/shadcn/ui/drawer';
  import { showSnackbar } from '$lib/util/snackbar';
  import {
    buildEnabledDictionaryMap,
    getInstalledDictionaries,
    lookupTerm,
    renderTermEntriesHtml,
    tokenizeText,
    type YomitanDictionarySummary,
    type YomitanToken
  } from '$lib/yomitan/core';
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
  import { addPopupAnkiNote } from '$lib/yomitan/anki-note';
  import type { VolumeMetadata } from '$lib/anki-connect';

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
    allowSwipeClose = true
  }: Props = $props();

  let dictionaries = $state<YomitanDictionarySummary[]>([]);
  let tokens = $state<YomitanToken[]>([]);
  let selectedTokenIndex = $state<number | null>(null);
  let lookupHtml = $state('');
  let loading = $state(false);
  let lookupLoading = $state(false);
  let errorMessage = $state('');
  let noEntries = $state(false);
  let selectionMessage = $state('');
  let lookupFrame: HTMLIFrameElement | null = $state(null);
  let lookupFrameHeight = $state(0);
  let awaitingLookupFrameLoad = $state(false);
  let prefersReducedMotion = $state(false);
  let lookupEntries = $state<unknown[]>([]);
  let selectedTokenText = $state('');
  let addingToAnki = $state(false);

  let swiping = $state(false);
  let swipePointerId = $state<number | null>(null);
  let swipeStartY = $state(0);
  let swipeStartTime = $state(0);
  let swipeOffsetY = $state(0);
  let debugEnabled = $state(false);

  let dragStyle = $derived(
    swiping ? `transform: translateY(${Math.max(0, swipeOffsetY)}px); transition: none;` : ''
  );

  function debugYomitan(message: string, details?: Record<string, unknown>) {
    logYomitanDebug('drawer', message, details);
  }

  async function copyDebugSnapshot() {
    try {
      const snapshot = buildYomitanDebugSnapshot({
        drawer: {
          open,
          loading,
          lookupLoading,
          tokenCount: tokens.length,
          selectableCount: tokens.filter((token) => token.selectable).length,
          selectedTokenIndex,
          hasLookupHtml: Boolean(lookupHtml),
          noEntries,
          errorMessage,
          sourceTextLength: sourceText.length,
          sourceTextPreview: sourceText.slice(0, 120),
          sourceTextCodePoints: getCodePointPreview(sourceText),
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

  function closeDrawer() {
    resetSwipe();
    open = false;
  }

  function resetDrawerState() {
    dictionaries = [];
    tokens = [];
    selectedTokenIndex = null;
    lookupHtml = '';
    errorMessage = '';
    noEntries = false;
    selectionMessage = '';
    loading = false;
    lookupLoading = false;
    awaitingLookupFrameLoad = false;
    lookupFrameHeight = 0;
    lookupEntries = [];
    selectedTokenText = '';
    addingToAnki = false;
    resetSwipe();
  }

  function resetSwipe() {
    swiping = false;
    swipePointerId = null;
    swipeOffsetY = 0;
    swipeStartY = 0;
    swipeStartTime = 0;
  }

  function handleSheetPointerDown(event: PointerEvent) {
    if (!allowSwipeClose) return;
    if (!event.isPrimary) return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    const target = event.target;
    if (
      event.pointerType === 'mouse' &&
      target instanceof Element &&
      target.closest('button, a, input, textarea, select, [role="button"]')
    ) {
      return;
    }
    swipePointerId = event.pointerId;
    swipeStartY = event.clientY;
    swipeStartTime = performance.now();
    swipeOffsetY = 0;
    swiping = true;
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  }

  function handleSheetPointerMove(event: PointerEvent) {
    if (!swiping || swipePointerId !== event.pointerId) return;
    swipeOffsetY = Math.max(0, event.clientY - swipeStartY);
  }

  function completeSwipe(event: PointerEvent) {
    if (!swiping || swipePointerId !== event.pointerId) return;

    const elapsedMs = Math.max(1, performance.now() - swipeStartTime);
    const velocity = swipeOffsetY / elapsedMs;
    const shouldClose = swipeOffsetY > 84 || (swipeOffsetY > 28 && velocity > 0.7);

    if (shouldClose) {
      closeDrawer();
      return;
    }

    resetSwipe();
  }

  function handleSheetPointerCancel(event: PointerEvent) {
    if (swipePointerId !== event.pointerId) return;
    resetSwipe();
  }

  function handleIframeMessage(event: MessageEvent) {
    if (!lookupFrame || event.source !== lookupFrame.contentWindow) return;

    const data = event.data as { type?: string; height?: unknown; entryIndex?: unknown } | null;
    if (!data) return;

    if (data.type === 'yomitan-iframe-height') {
      const nextHeight = typeof data.height === 'number' ? Math.ceil(data.height) : 0;
      if (nextHeight > 0) {
        lookupFrameHeight = nextHeight;
      }
      return;
    }

    if (data.type === 'yomitan-add-note') {
      const entryIndex =
        typeof data.entryIndex === 'number' ? data.entryIndex : Number(data.entryIndex);
      if (!Number.isFinite(entryIndex) || entryIndex < 0 || entryIndex >= lookupEntries.length) {
        return;
      }
      void handleAddToAnki(entryIndex);
    }
  }

  async function handleAddToAnki(entryIndex: number) {
    if (!ankiEnabled) {
      showSnackbar('Enable Anki integration in settings first.');
      return;
    }

    const entry = lookupEntries[entryIndex];
    if (!entry) return;

    addingToAnki = true;
    try {
      const source = selectedTokenText || sourceText;
      const result = await addPopupAnkiNote(entry, source, volumeMetadata);
      if (result.noteId) {
        showSnackbar('Added note to Anki.');
      } else {
        showSnackbar('Failed to add note to Anki.');
      }
    } catch (error) {
      console.error('Failed to add Yomitan note to Anki:', error);
      const message = error instanceof Error ? error.message : String(error);
      showSnackbar(`Failed to add note: ${message}`);
    } finally {
      addingToAnki = false;
    }
  }

  async function loadAndTokenizeText() {
    const text = sourceText.trim();
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
        debugYomitan('load:no-tokens', {
          textLength: text.length,
          textPreview: text.slice(0, 120),
          textCodePoints: getCodePointPreview(text)
        });
        return;
      }

      const firstSelectableTokenIndex = tokens.findIndex((token) => token.selectable);
      if (firstSelectableTokenIndex >= 0) {
        await handleTokenClick(tokens[firstSelectableTokenIndex], firstSelectableTokenIndex);
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
    if (selectedTokenIndex === index && (lookupHtml || noEntries || lookupLoading)) {
      return;
    }
    selectedTokenIndex = index;
    lookupLoading = true;
    awaitingLookupFrameLoad = false;
    noEntries = false;
    selectionMessage = '';

    try {
      const normalizedPreferences = normalizeDictionaryPreferences(
        dictionaries.map((item) => item.title),
        loadDictionaryPreferences()
      );
      const enabledMap = buildEnabledDictionaryMap(normalizedPreferences);
      debugYomitan('lookup:start', {
        tokenText: token.text,
        tokenIndex: index,
        enabledDictionaryCount: enabledMap.size
      });

      const lookup = await lookupTerm(token.text, enabledMap);
      selectedTokenText = token.text;
      lookupEntries = lookup.entries;
      debugYomitan('lookup:complete', {
        tokenText: token.text,
        entryCount: lookup.entries.length,
        originalTextLength: lookup.originalTextLength
      });
      if (!lookup.entries.length) {
        noEntries = true;
        return;
      }

      lookupHtml = await renderTermEntriesHtml(lookup.entries, { showAnkiAddButton: ankiEnabled });
      awaitingLookupFrameLoad = true;
    } catch (error) {
      console.error('Yomitan lookup failed:', error);
      debugYomitan('lookup:failed', {
        tokenText: token.text,
        error: error instanceof Error ? error.message : String(error)
      });
      showSnackbar('Failed to look up token in Yomitan.');
      noEntries = true;
    } finally {
      if (!awaitingLookupFrameLoad) {
        lookupLoading = false;
      }
    }
  }

  function handleLookupFrameLoad() {
    if (!awaitingLookupFrameLoad) return;
    awaitingLookupFrameLoad = false;
    lookupLoading = false;
  }

  $effect(() => {
    if (typeof window === 'undefined') return;

    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    const syncPreference = () => {
      prefersReducedMotion = mediaQuery.matches;
    };

    syncPreference();
    mediaQuery.addEventListener('change', syncPreference);

    return () => {
      mediaQuery.removeEventListener('change', syncPreference);
    };
  });

  $effect(() => {
    if (!open) {
      resetDrawerState();
      return;
    }

    debugEnabled = isYomitanDebugEnabled();
    loadAndTokenizeText();
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
  onmessage={handleIframeMessage}
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

<Drawer.Root bind:open dismissible={outsideClose} direction="bottom" modal={true}>
  <Drawer.Content
    data-yomitan-drawer
    overlayClass="!z-[11999] !bg-gray-950/35"
    class="z-[12000] h-[80vh] w-full max-w-none flex-col overflow-hidden rounded-t-2xl border border-gray-700/80 bg-gray-900 text-white shadow-2xl md:right-auto md:left-3 md:w-1/2 [&>div:first-child]:hidden"
    style={dragStyle}
  >
    <div
      class="shrink-0"
      onpointerdown={handleSheetPointerDown}
      onpointermove={handleSheetPointerMove}
      onpointerup={completeSwipe}
      onpointercancel={handleSheetPointerCancel}
    >
      <div class="touch-none px-4 pt-1.5 pb-0.5 select-none">
        <div class="flex justify-center">
          <div class="h-1.5 w-10 rounded-full bg-gray-600/80"></div>
        </div>
      </div>
      {#if !loading}
        <section class="max-h-52 overflow-y-auto border-b border-gray-800 px-4 pt-2 pb-4 fade-in">
          {#if errorMessage}
            <p class="text-sm text-red-300">{errorMessage}</p>
          {:else}
            <div class="flex flex-wrap items-end text-gray-100 select-text">
              {#each tokens as token, index (`token-${index}-${token.text}`)}
                {#if token.selectable}
                  <button
                    type="button"
                    class={`focus-visible:outline-primary-500 inline appearance-none rounded-sm border-0 bg-transparent px-0.5 py-0 text-[1.05rem] leading-8 text-gray-100 underline underline-offset-3 transition-colors select-text hover:text-white hover:decoration-gray-300 focus-visible:outline focus-visible:outline-1 ${selectedTokenIndex === index ? 'decoration-primary-400 bg-gray-700/70' : 'decoration-gray-500/70'}`}
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
        {#if !loading}
          <div class="pointer-events-none absolute top-3 right-3 z-20 flex gap-2 fade-in">
            {#if addingToAnki}
              <div
                class="pointer-events-auto rounded bg-gray-800/90 px-2 py-1 text-xs text-gray-100"
              >
                Adding...
              </div>
            {/if}
            {#if debugEnabled}
              <Button
                outline
                color="light"
                class="pointer-events-auto !bg-gray-900/80 !text-gray-100 backdrop-blur-sm"
                onclick={copyDebugSnapshot}>Copy debug snapshot</Button
              >
            {/if}
          </div>
        {/if}

        <div class="pointer-events-none absolute right-3 bottom-3 z-30 fade-in">
          <Button
            outline
            color="light"
            class="pointer-events-auto !bg-gray-900/80 !text-gray-100 backdrop-blur-sm"
            onclick={closeDrawer}>Close</Button
          >
        </div>

        {#if selectionMessage}
          <div
            class="flex h-full items-center justify-center px-5 text-center text-sm text-gray-600"
          >
            {selectionMessage}
          </div>
        {:else if noEntries}
          <div class="flex h-full items-center justify-center text-sm text-gray-600">
            No dictionary entries found for this token.
          </div>
        {:else if lookupHtml}
          <div class="h-full overflow-x-hidden overflow-y-auto fade-in">
            <iframe
              bind:this={lookupFrame}
              title="Yomitan dictionary results"
              class="block w-full border-0 bg-[#1e1e1e]"
              scrolling="yes"
              style={`height: ${lookupFrameHeight > 0 ? `${lookupFrameHeight}px` : '100%'}; overflow:auto; touch-action: pan-y; background-color:#1e1e1e;`}
              srcdoc={lookupHtml}
              onload={handleLookupFrameLoad}
            ></iframe>
          </div>
        {/if}

        {#if lookupLoading}
          <div class="absolute inset-0 bg-[#1e1e1e]"></div>
        {/if}
      </section>
    </div>
  </Drawer.Content>
</Drawer.Root>

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
