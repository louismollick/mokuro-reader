<script lang="ts">
  import { onDestroy } from 'svelte';
  import { createDisplayController, DuplicateNoteError } from 'yomitan-core';
  import type { AnkiNoteContext, TermDictionaryEntry, Yomitan } from 'yomitan-core';
  import { syncAnkiWeb } from '$lib/anki-connect';
  import { showSnackbar } from '$lib/util/snackbar';
  import { primaryHeadword } from '$lib/yomitan/entry-data';
  import type { MinedPanels } from '$lib/yomitan/mined-panels.svelte';
  import { mineWord, type PanelSource } from '$lib/yomitan/mining';
  import type { NoteStates } from '$lib/yomitan/note-states';
  import { profileScreenshotFields } from '$lib/yomitan/panel-adjust';

  type DisplayController = ReturnType<typeof createDisplayController>;

  interface Props {
    client: Yomitan;
    entry: TermDictionaryEntry;
    /** Null when AnkiConnect is off: no Anki button. */
    controller: DisplayController | null;
    noteContext: AnkiNoteContext;
    extraMarkers: Record<string, string>;
    noteStates: NoteStates;
    /** Where the Panel Crop is cut from; null when the page image isn't available. */
    panelSource: PanelSource | null;
    minedPanels: MinedPanels;
  }

  let {
    client,
    entry,
    controller,
    noteContext,
    extraMarkers,
    noteStates,
    panelSource,
    minedPanels
  }: Props = $props();

  let audio = $derived(client.profile.get().options.audio);
  let hasAudio = $derived(audio.sources.length > 0 || audio.enableDefaultAudioSources);

  // One element for the whole entry: iOS only lets `play()` run inside a tap, so the fallback to
  // the next URL must reuse the element the tap already unlocked. The URLs belong to one entry.
  let player: HTMLAudioElement | null = null;
  let urls: { entry: TermDictionaryEntry; found: Promise<string[]> } | null = null;

  /** The audio URLs of `target`, resolved once the button is first needed. */
  function loadUrls(target: TermDictionaryEntry) {
    if (urls?.entry !== target) {
      const { term, reading } = primaryHeadword(target);
      urls = {
        entry: target,
        found: client.audio
          .urls(term, reading)
          .then((found) => found.map(({ url }) => url))
          .catch(() => [])
      };
    }
    return urls.found;
  }

  async function play() {
    const target = entry;
    const element = (player ??= new Audio());
    const candidates = await loadUrls(target);
    for (const url of candidates) {
      // The user moved on to another word while the sources were resolving.
      if (target !== entry) return;
      try {
        element.src = url;
        await element.play();
        return;
      } catch {
        // Try the next source.
      }
    }
    if (target === entry) showSnackbar('No audio found.');
  }

  // Sound stops with the entry it belongs to, and with the component.
  $effect(() => {
    void entry;
    return () => {
      player?.pause();
      urls = null;
    };
  });
  onDestroy(() => {
    player?.pause();
    player?.removeAttribute('src');
    player = null;
  });

  /** `checking` until Anki says whether it has the word, so a known word never flashes `+`. */
  let ankiState = $state<'checking' | 'idle' | 'adding' | 'added' | 'in-anki' | 'error'>(
    'checking'
  );
  /** The card format the button saves with, and why it can't, if it can't. */
  let ankiTarget = $state<{ cardFormatIndex: number; disabled: string | null } | null>(null);

  /** Bumped whenever the entry or controller changes, so a save in flight can tell it is stale. */
  let generation = 0;

  $effect(() => {
    const active = controller;
    void entry;
    generation++;
    ankiState = 'checking';
    ankiTarget = null;
    if (!active) return;
    let stale = false;
    noteStates
      .get(active, entry, noteContext, extraMarkers)
      .then((state) => {
        if (stale) return;
        ankiTarget = state;
        // Unless a save started meanwhile (after `patience` gave up waiting).
        if (ankiState === 'checking' || ankiState === 'idle') {
          ankiState = state?.inAnki ? 'in-anki' : 'idle';
        }
      })
      .catch(() => {
        if (!stale) ankiState = 'idle';
      });
    // A slow Anki must not hold the button: offer "add" and let the answer correct it.
    const patience = setTimeout(() => {
      if (!stale && ankiState === 'checking') ankiState = 'idle';
    }, 1500);
    return () => {
      stale = true;
      clearTimeout(patience);
    };
  });

  async function addToAnki() {
    if (!controller || ankiState === 'adding' || ankiState === 'checking') return;
    // What was saved is the entry as of the tap, whatever the button shows by the time Anki answers.
    const target = entry;
    const mine = generation;
    ankiState = 'adding';
    try {
      const cardFormatIndex = ankiTarget?.cardFormatIndex ?? 0;
      // A card format without `{screenshot}` has no use for a Panel Crop.
      const wantsPanel = profileScreenshotFields(client, cardFormatIndex).length > 0;
      const { panel, warnings } = await mineWord({
        controller,
        entry: target,
        cardFormatIndex,
        context: noteContext,
        extraMarkers,
        source: wantsPanel ? panelSource : null,
        screenshots: minedPanels.screenshots
      });
      noteStates.markAdded(target);
      if (panel) minedPanels.set(target, panel);
      void syncAnkiWeb();
      showSnackbar(
        warnings.length > 0 ? `Added note, but ${warnings.join(', ')}.` : 'Added note to Anki.'
      );
      if (mine === generation) ankiState = 'added';
    } catch (error) {
      if (error instanceof DuplicateNoteError) {
        noteStates.markAdded(target);
        if (mine === generation) ankiState = 'in-anki';
        return;
      }
      console.error('Failed to add note to Anki:', error);
      showSnackbar(`Failed to add note: ${error instanceof Error ? error.message : error}`);
      if (mine === generation) ankiState = 'error';
    }
  }
</script>

<div class="relative z-10 flex shrink-0 items-center gap-2">
  {#if hasAudio}
    <button type="button" class="action" aria-label="Play audio" onclick={play}>
      <svg viewBox="0 0 24 24" class="h-4 w-4" fill="currentColor" aria-hidden="true"
        ><path d="M8 5v14l11-7z" /></svg
      >
    </button>
  {/if}
  {#if controller}
    {#if ankiState === 'added' || ankiState === 'in-anki'}
      <span
        class="action done"
        role="img"
        aria-label={ankiState === 'added' ? 'Added to Anki' : 'In Anki'}
      >
        <svg
          viewBox="0 0 24 24"
          class="h-4 w-4"
          fill="none"
          stroke="currentColor"
          stroke-width="3"
          aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg
        >
      </span>
    {:else}
      <button
        type="button"
        class="action"
        aria-label={ankiState === 'error' ? 'Add to Anki failed, retry' : 'Add to Anki'}
        title={ankiTarget?.disabled ?? undefined}
        disabled={!!ankiTarget?.disabled || ankiState === 'checking'}
        aria-busy={ankiState === 'adding' || ankiState === 'checking'}
        onclick={addToAnki}
      >
        {#if ankiState === 'checking'}
          <!-- An empty ring until Anki answers: neither "add" nor "in deck" yet. -->
        {:else if ankiState === 'adding'}
          <svg viewBox="0 0 24 24" class="h-4 w-4 animate-spin" fill="none" aria-hidden="true"
            ><circle
              cx="12"
              cy="12"
              r="9"
              stroke="currentColor"
              stroke-opacity=".3"
              stroke-width="3"
            /><path
              d="M21 12a9 9 0 0 0-9-9"
              stroke="currentColor"
              stroke-width="3"
              stroke-linecap="round"
            /></svg
          >
        {:else if ankiState === 'error'}
          <span class="text-[17px] leading-none font-bold text-red-400" aria-hidden="true">!</span>
        {:else}
          <svg
            viewBox="0 0 24 24"
            class="h-4 w-4"
            fill="none"
            stroke="currentColor"
            stroke-width="2.5"
            stroke-linecap="round"
            aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg
          >
        {/if}
      </button>
    {/if}
  {/if}
</div>

<style>
  .action {
    display: inline-flex;
    height: 36px;
    width: 36px;
    align-items: center;
    justify-content: center;
    border-radius: 9999px;
    border: 1.5px solid var(--color-white, #fff);
    color: var(--color-white, #fff);
    background: transparent;
    transition:
      background-color 120ms ease-out,
      border-color 120ms ease-out,
      opacity 120ms ease-out;
  }

  .action:disabled {
    opacity: 0.4;
  }

  .action[aria-busy='true']:disabled {
    opacity: 0.25;
  }

  /* In the deck: a solid success disc, so it never reads as the outlined "add". */
  .action.done {
    border-color: var(--color-green-600, #16a34a);
    background: var(--color-green-600, #16a34a);
    color: var(--color-on-accent, #fff);
  }

  .action:focus-visible {
    outline: 2px solid var(--color-primary-500);
    outline-offset: 2px;
  }
</style>
