<script lang="ts">
  import { createDisplayController, DuplicateNoteError } from 'yomitan-core';
  import type { AnkiNoteContext, TermDictionaryEntry, Yomitan } from 'yomitan-core';
  import { syncAnkiWeb } from '$lib/anki-connect';
  import { showSnackbar } from '$lib/util/snackbar';
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

  let headword = $derived(entry.headwords[0]);
  let audio = $derived(client.profile.get().options.audio);
  let hasAudio = $derived(audio.sources.length > 0 || audio.enableDefaultAudioSources);

  // One element for the whole entry: iOS only lets `play()` run inside a tap, so the fallback to
  // the next URL must reuse the element the tap already unlocked.
  let player: HTMLAudioElement | null = null;
  let urls: Promise<string[]> | null = null;

  /** The audio URLs, resolved once the button is first needed. */
  function loadUrls() {
    urls ??= client.audio
      .urls(headword.term, headword.reading)
      .then((found) => found.map(({ url }) => url))
      .catch(() => []);
    return urls;
  }

  async function play() {
    const element = (player ??= new Audio());
    const candidates = await loadUrls();
    for (const url of candidates) {
      try {
        element.src = url;
        await element.play();
        return;
      } catch {
        // Try the next source.
      }
    }
    showSnackbar('No audio found.');
  }

  let ankiState = $state<'idle' | 'adding' | 'added' | 'in-anki' | 'error'>('idle');
  /** The card format the button saves with, and why it can't, if it can't. */
  let ankiTarget = $state<{ cardFormatIndex: number; disabled: string | null } | null>(null);

  $effect(() => {
    const active = controller;
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
    ankiState = 'adding';
    try {
      await controller.addNote(entry, ankiTarget?.cardFormatIndex ?? 0, noteContext, extraMarkers);
      noteStates.markAdded(entry);
      ankiState = 'added';
      void syncAnkiWeb();
      showSnackbar('Added note to Anki.');
    } catch (error) {
      if (error instanceof DuplicateNoteError) {
        ankiState = 'in-anki';
        return;
      }
      console.error('Failed to add note to Anki:', error);
      ankiState = 'error';
      showSnackbar(`Failed to add note: ${error instanceof Error ? error.message : error}`);
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
