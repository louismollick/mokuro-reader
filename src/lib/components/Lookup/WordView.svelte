<script lang="ts">
  import type {
    AnkiNoteContext,
    DisplayController,
    GlossaryBlock,
    TermDictionaryEntry,
    Yomitan
  } from 'yomitan-core';
  import { primaryHeadword } from '$lib/yomitan/entry-data';
  import type { MinedPanels } from '$lib/yomitan/mined-panels.svelte';
  import type { PanelSource } from '$lib/yomitan/mining';
  import type { NoteStates } from '$lib/yomitan/note-states';
  import Glossary from './Glossary.svelte';
  import Headword from './Headword.svelte';
  import PanelThumb from './PanelThumb.svelte';
  import WordActions from './WordActions.svelte';

  interface Props {
    client: Yomitan;
    /** The entries for the Word, best first. */
    entries: TermDictionaryEntry[];
    /** Each entry's glossaries by dictionary, rendered before the view is shown. */
    glossaries: GlossaryBlock[][];
    /** The text that was looked up. */
    surface: string;
    /** Peek: the first entry's first dictionary, cut after its first sense. */
    compact: boolean;
    glossaryStyle: { css: string; attributes: Record<string, string> };
    controller: DisplayController | null;
    noteContext: AnkiNoteContext;
    extraMarkers: Record<string, string>;
    noteStates: NoteStates;
    panelSource: PanelSource | null;
    minedPanels: MinedPanels;
    /** The Panel Crop thumbnail of `entry` was tapped. */
    onAdjust: (entry: TermDictionaryEntry) => void;
    onKanji: (character: string) => void;
    onQuery: (query: string) => void;
  }

  let {
    client,
    entries,
    glossaries,
    surface,
    compact,
    glossaryStyle,
    controller,
    noteContext,
    extraMarkers,
    noteStates,
    panelSource,
    minedPanels,
    onAdjust,
    onKanji,
    onQuery
  }: Props = $props();

  /** Identifies an entry, so its actions (audio, Anki state) are never reused for another word. */
  function entryKey(entry: TermDictionaryEntry, index: number) {
    const { term, reading } = primaryHeadword(entry);
    return `${index}|${term}|${reading}`;
  }

  let shown = $derived(compact ? entries.slice(0, 1) : entries);
</script>

{#each shown as entry, index (entryKey(entry, index))}
  {@const mined = minedPanels.get(entry)}
  {@const blocks = glossaries[index] ?? []}
  <section class="entry" class:next={index > 0}>
    <div class="flex items-start justify-between gap-3">
      <Headword {entry} {surface} {compact} {onKanji} />
      <WordActions
        {client}
        {entry}
        {controller}
        {noteContext}
        {extraMarkers}
        {noteStates}
        {panelSource}
        {minedPanels}
      />
    </div>
    {#if mined}
      <PanelThumb image={mined.image} onAdjust={() => onAdjust(entry)} />
    {/if}
    {#each compact ? blocks.slice(0, 1) : blocks as block (block.dictionary)}
      <Glossary {client} {block} style={glossaryStyle} {compact} {onQuery} />
    {/each}
  </section>
{/each}

<style>
  .entry.next {
    margin-top: 12px;
    padding-top: 12px;
    border-top: 1px solid var(--color-gray-700);
  }
</style>
