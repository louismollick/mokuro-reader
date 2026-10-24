<script lang="ts">
  import { onDestroy } from 'svelte';
  import { createDisplayController, DuplicateNoteError } from 'yomitan-core';
  import type { AnkiNoteContext, TermDictionaryEntry, Yomitan } from 'yomitan-core';
  import { syncAnkiWeb } from '$lib/anki-connect';
  import { showSnackbar } from '$lib/util/snackbar';
  import { primaryHeadword } from '$lib/yomitan/entry-data';
  import type { NoteStates } from '$lib/yomitan/note-states';

  type DisplayController = ReturnType<typeof createDisplayController>;

  interface Props {
    client: Yomitan;
    entry: TermDictionaryEntry;
    /** Null when AnkiConnect is off: no Anki button. */
    controller: DisplayController | null;
    noteContext: AnkiNoteContext;
    extraMarkers: Record<string, string>;
    noteStates: NoteStates;
  }

  let { client, entry, controller, noteContext, extraMarkers, noteStates }: Props = $props();

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

  let ankiState = $state<'idle' | 'adding' | 'added' | 'in-anki' | 'error'>('idle');
  /** The card format the button saves with, and why it can't, if it can't. */
  let ankiTarget = $state<{ cardFormatIndex: number; disabled: string | null } | null>(null);

  /** Bumped whenever the entry or controller changes, so a save in flight can tell it is stale. */
  let generation = 0;

  $effect(() => {
    const active = controller;
    void entry;
    generation++;
    ankiState = 'idle';
    ankiTarget = null;
    if (!active) return;
    let stale = false;
    noteStates
      .get(active, entry, noteContext, extraMarkers)
      .then((state) => {
        if (stale || !state) return;
        ankiTarget = state;
        if (state.inAnki) ankiState = 'in-anki';
      })
      .catch(() => {});
    return () => (stale = true);
  });

  async function addToAnki() {
    if (!controller || ankiState === 'adding') return;
    // What was saved is the entry as of the tap, whatever the button shows by the time Anki answers.
    const target = entry;
    const mine = generation;
    ankiState = 'adding';
    try {
      await controller.addNote(target, ankiTarget?.cardFormatIndex ?? 0, noteContext, extraMarkers);
      noteStates.markAdded(target);
      void syncAnkiWeb();
      showSnackbar('Added note to Anki.');
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
        disabled={!!ankiTarget?.disabled}
        aria-busy={ankiState === 'adding'}
        onclick={addToAnki}
      >
        {#if ankiState === 'adding'}
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
          <span class="text-[17px] leading-none font-bold text-[#f87171]" aria-hidden="true">!</span
          >
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
    border: 1.5px solid #fff;
    color: #fff;
    background: transparent;
  }

  .action:disabled {
    opacity: 0.4;
  }

  .action.done {
    border-color: #4ade80;
    color: #4ade80;
  }

  .action:focus-visible {
    outline: 2px solid #f5c542;
    outline-offset: 2px;
  }
</style>
