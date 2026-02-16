<script lang="ts">
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
  }

  let { open = $bindable(false), sourceText = '', onClose }: Props = $props();

  let dictionaries = $state<YomitanDictionarySummary[]>([]);
  let tokens = $state<YomitanToken[]>([]);
  let selectedToken = $state<YomitanToken | null>(null);
  let lookupHtml = $state('');
  let loading = $state(false);
  let lookupLoading = $state(false);
  let errorMessage = $state('');
  let noEntries = $state(false);
  let lookupFrame: HTMLIFrameElement | null = $state(null);
  let lookupFrameHeight = $state(0);

  function closeDrawer() {
    open = false;
    onClose?.();
  }

  function resetDrawerState() {
    dictionaries = [];
    tokens = [];
    selectedToken = null;
    lookupHtml = '';
    errorMessage = '';
    noEntries = false;
    loading = false;
    lookupLoading = false;
    lookupFrameHeight = 0;
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
      }
    } catch (error) {
      console.error('Yomitan tokenization failed:', error);
      errorMessage = 'Failed to initialize Yomitan.';
    } finally {
      loading = false;
    }
  }

  async function handleTokenClick(token: YomitanToken) {
    selectedToken = token;
    lookupLoading = true;
    noEntries = false;
    lookupHtml = '';

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
  <div data-yomitan-drawer class="fixed inset-0 z-[12000] bg-gray-950/95 text-white">
    <div class="flex h-full flex-col">
      <div class="flex items-center justify-between border-b border-gray-700 px-4 py-3">
        <div>
          <h2 class="text-lg font-semibold">Yomitan</h2>
          <p class="text-xs text-gray-400">Tap a token to view dictionary entries</p>
        </div>
        <button
          type="button"
          class="rounded border border-gray-600 px-3 py-1 text-sm hover:bg-gray-800"
          onclick={closeDrawer}
        >
          Close
        </button>
      </div>

      <div class="flex min-h-0 flex-1 flex-col md:grid md:grid-cols-[360px_1fr]">
        <section
          class="max-h-48 overflow-y-auto border-b border-gray-800 p-4 md:max-h-none md:border-r md:border-b-0"
        >
          {#if loading}
            <p class="text-sm text-gray-300">Loading Yomitan...</p>
          {:else if errorMessage}
            <p class="text-sm text-red-300">{errorMessage}</p>
          {:else}
            <div class="flex flex-wrap gap-2">
              {#each tokens as token, index (`token-${index}-${token.text}`)}
                <button
                  type="button"
                  class="rounded border border-gray-600 px-2 py-1 text-left text-sm hover:border-primary-500 hover:bg-gray-800"
                  class:border-primary-500={selectedToken?.text === token.text}
                  onclick={() => handleTokenClick(token)}
                >
                  {token.text}
                </button>
              {/each}
            </div>
          {/if}
        </section>

        <section class="min-h-0 flex-1 overflow-hidden bg-white">
          {#if lookupLoading}
            <div class="flex h-full items-center justify-center text-sm text-gray-600">
              Looking up token...
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
          {:else}
            <div class="flex h-full items-center justify-center text-sm text-gray-600">
              Select a token to view dictionary results.
            </div>
          {/if}
        </section>
      </div>
    </div>
  </div>
{/if}
