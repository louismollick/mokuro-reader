<script lang="ts">
  import { Button } from 'flowbite-svelte';
  import { sineIn, sineOut } from 'svelte/easing';
  import { fly } from 'svelte/transition';
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
    loadDictionaryPreferences,
    normalizeDictionaryPreferences,
    saveDictionaryPreferences
  } from '$lib/yomitan/preferences';

  interface Props {
    open?: boolean;
    sourceText?: string;
    onClose?: () => void;
    outsideClose?: boolean;
    allowSwipeClose?: boolean;
  }

  let {
    open = $bindable(false),
    sourceText = '',
    onClose,
    outsideClose = true,
    allowSwipeClose = true
  }: Props = $props();

  let dictionaries = $state<YomitanDictionarySummary[]>([]);
  let tokens = $state<YomitanToken[]>([]);
  let selectedToken = $state<YomitanToken | null>(null);
  let lookupHtml = $state('');
  let loading = $state(false);
  let lookupLoading = $state(false);
  let errorMessage = $state('');
  let noEntries = $state(false);
  let selectionMessage = $state('');
  let lookupFrame: HTMLIFrameElement | null = $state(null);
  let lookupFrameHeight = $state(0);
  let prefersReducedMotion = $state(false);

  let swiping = $state(false);
  let swipePointerId = $state<number | null>(null);
  let swipeStartY = $state(0);
  let swipeStartTime = $state(0);
  let swipeOffsetY = $state(0);

  let dragStyle = $derived(
    swiping ? `transform: translateY(${Math.max(0, swipeOffsetY)}px); transition: none;` : ''
  );

  function closeDrawer() {
    resetSwipe();
    open = false;
    onClose?.();
  }

  function handleBackdropClick() {
    if (!outsideClose) return;
    closeDrawer();
  }

  function resetDrawerState() {
    dictionaries = [];
    tokens = [];
    selectedToken = null;
    lookupHtml = '';
    errorMessage = '';
    noEntries = false;
    selectionMessage = '';
    loading = false;
    lookupLoading = false;
    lookupFrameHeight = 0;
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
    if (event.pointerType === 'mouse' && event.button !== 0) return;
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

    const data = event.data as { type?: string; height?: unknown } | null;
    if (!data || data.type !== 'yomitan-iframe-height') return;

    const nextHeight = typeof data.height === 'number' ? Math.ceil(data.height) : 0;
    if (nextHeight > 0) {
      lookupFrameHeight = nextHeight;
    }
  }

  async function loadAndTokenizeText() {
    const text = sourceText.trim();
    if (!text) {
      errorMessage = 'No text found for this box.';
      return;
    }

    loading = true;
    errorMessage = '';

    try {
      dictionaries = await getInstalledDictionaries();
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
      if (enabledMap.size === 0) {
        errorMessage = 'All dictionaries are disabled. Enable at least one in Settings > Yomitan.';
        return;
      }

      tokens = await tokenizeText(text, enabledMap);
      if (tokens.length === 0) {
        errorMessage = 'No tokens found for this text.';
        return;
      }

      const firstSelectableToken = tokens.find((token) => token.selectable);
      if (firstSelectableToken) {
        await handleTokenClick(firstSelectableToken);
      } else {
        selectionMessage = 'No selectable words found for this text.';
      }
    } catch (error) {
      console.error('Yomitan tokenization failed:', error);
      errorMessage = 'Failed to initialize Yomitan.';
    } finally {
      loading = false;
    }
  }

  async function handleTokenClick(token: YomitanToken) {
    if (!token.selectable) return;
    selectedToken = token;
    lookupLoading = true;
    noEntries = false;
    selectionMessage = '';

    try {
      const normalizedPreferences = normalizeDictionaryPreferences(
        dictionaries.map((item) => item.title),
        loadDictionaryPreferences()
      );
      const enabledMap = buildEnabledDictionaryMap(normalizedPreferences);

      const lookup = await lookupTerm(token.text, enabledMap);
      if (!lookup.entries.length) {
        noEntries = true;
        return;
      }

      lookupHtml = await renderTermEntriesHtml(lookup.entries);
    } catch (error) {
      console.error('Yomitan lookup failed:', error);
      showSnackbar('Failed to look up token in Yomitan.');
      noEntries = true;
    } finally {
      lookupLoading = false;
    }
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

    loadAndTokenizeText();
  });
</script>

<svelte:window
  onmessage={handleIframeMessage}
  onkeydown={(event) => {
    if (open && event.key === 'Escape') {
      closeDrawer();
    }
  }}
/>

{#if open}
  <div class="fixed inset-0 z-[12000] flex items-end justify-start md:pl-3">
    <button
      type="button"
      aria-label="Close Yomitan popup"
      class="absolute inset-0 bg-gray-950/35"
      onclick={handleBackdropClick}
    ></button>

    <div
      data-yomitan-drawer
      class="relative z-10 flex h-[80vh] w-full flex-col overflow-hidden rounded-t-2xl border border-gray-700/80 bg-gray-900 text-white shadow-2xl md:w-1/2"
      style={dragStyle}
      in:fly={{
        y: prefersReducedMotion ? 0 : 56,
        duration: prefersReducedMotion ? 120 : 200,
        easing: sineOut,
        opacity: 1
      }}
      out:fly={{
        y: prefersReducedMotion ? 0 : 56,
        duration: prefersReducedMotion ? 120 : 200,
        easing: sineIn,
        opacity: 1
      }}
    >
      <div
        class="touch-none select-none px-4 pt-1.5 pb-0.5"
        onpointerdown={handleSheetPointerDown}
        onpointermove={handleSheetPointerMove}
        onpointerup={completeSwipe}
        onpointercancel={handleSheetPointerCancel}
      >
        <div class="flex justify-center">
          <div class="h-1.5 w-10 rounded-full bg-gray-600/80"></div>
        </div>
      </div>

      <div class="min-h-0 flex flex-1 flex-col">
        <section class="max-h-52 overflow-y-auto border-b border-gray-800 px-4 pt-2 pb-4">
          {#if loading}
            <p class="text-[1.05rem] leading-8 text-gray-200">{sourceText}</p>
          {:else if errorMessage}
            <p class="text-sm text-red-300">{errorMessage}</p>
          {:else}
            <div class="flex flex-wrap items-end text-gray-100">
              {#each tokens as token, index (`token-${index}-${token.text}`)}
                {#if token.selectable}
                  <button
                    type="button"
                    class={`inline rounded-sm px-0.5 py-0 text-[1.05rem] leading-8 text-gray-100 underline underline-offset-3 transition-colors hover:text-white hover:decoration-gray-300 focus-visible:outline focus-visible:outline-1 focus-visible:outline-primary-500 ${selectedToken === token ? 'bg-gray-700/70 decoration-primary-400' : 'decoration-gray-500/70'}`}
                    onclick={() => handleTokenClick(token)}
                  >
                    {token.text}
                  </button>
                {:else}
                  <span class="px-0.5 py-0 text-[1.05rem] leading-8 text-gray-200">{token.text}</span>
                {/if}
              {/each}
            </div>
          {/if}
        </section>

        <section class="relative min-h-0 flex-1 overflow-hidden bg-[#1e1e1e]">
          <div class="pointer-events-none absolute top-3 right-3 z-20">
            <Button
              outline
              color="light"
              class="pointer-events-auto !bg-gray-900/80 !text-gray-100 backdrop-blur-sm"
              onclick={closeDrawer}
              >Close</Button
            >
          </div>

          {#if selectionMessage}
            <div class="flex h-full items-center justify-center px-5 text-center text-sm text-gray-600">
              {selectionMessage}
            </div>
          {:else if noEntries}
            <div class="flex h-full items-center justify-center text-sm text-gray-600">
              No dictionary entries found for this token.
            </div>
          {:else if lookupHtml}
            <div class="h-full overflow-y-auto overflow-x-hidden">
              <iframe
                bind:this={lookupFrame}
                title="Yomitan dictionary results"
                class="block w-full border-0"
                scrolling="yes"
                style={`height: ${lookupFrameHeight > 0 ? `${lookupFrameHeight}px` : '100%'}; overflow:auto; touch-action: pan-y;`}
                srcdoc={lookupHtml}
              ></iframe>
            </div>
          {/if}

          {#if lookupLoading}
            <div class="absolute inset-0 bg-[#1e1e1e]/35 backdrop-blur-[1px]"></div>
          {/if}
        </section>
      </div>
    </div>
  </div>
{/if}
