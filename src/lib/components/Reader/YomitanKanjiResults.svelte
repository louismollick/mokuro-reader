<script lang="ts">
  import type { Summary, KanjiDictionaryEntry } from 'yomitan-core';
  import {
    createKanjiEntryRenderer,
    type YomitanRenderedKanjiEntry,
    type YomitanRenderHostOptions,
    type YomitanPopupTheme,
    type YomitanKanjiEntryRenderer
  } from '$lib/yomitan/core';

  interface Props {
    entries: KanjiDictionaryEntry[];
    dictionaryInfo: Summary[];
    theme?: YomitanPopupTheme;
    language?: string;
    glossaryLayoutMode?: string;
    resultOutputMode?: string;
  }

  let {
    entries,
    dictionaryInfo,
    theme = 'dark',
    language,
    glossaryLayoutMode,
    resultOutputMode
  }: Props = $props();

  let mountNode: HTMLDivElement | null = $state(null);
  let kanjiEntryRenderer: YomitanKanjiEntryRenderer | null = $state(null);
  let renderedEntries = $state<YomitanRenderedKanjiEntry[]>([]);

  function buildRenderOptions(): YomitanRenderHostOptions {
    return {
      theme,
      language,
      glossaryLayoutMode,
      resultOutputMode
    };
  }

  function mountEntryNode(node: HTMLElement, entryNode: HTMLElement) {
    node.replaceChildren(entryNode);

    return {
      update(nextEntryNode: HTMLElement) {
        if (nextEntryNode === entryNode) return;
        entryNode = nextEntryNode;
        node.replaceChildren(nextEntryNode);
      },
      destroy() {
        node.replaceChildren();
      }
    };
  }

  $effect(() => {
    if (!mountNode) return;

    const renderer = createKanjiEntryRenderer();
    kanjiEntryRenderer = renderer;
    renderer.prepareHost(mountNode, buildRenderOptions());

    return () => {
      renderedEntries = [];
      renderer.destroy();
      kanjiEntryRenderer = null;
    };
  });

  $effect(() => {
    if (!mountNode || !kanjiEntryRenderer) return;

    const options = buildRenderOptions();
    kanjiEntryRenderer.updateHost(mountNode, options);
    renderedEntries = kanjiEntryRenderer.renderKanjiEntries(entries, dictionaryInfo, options);
  });
</script>

<div
  bind:this={mountNode}
  class="h-full min-h-0 overflow-x-hidden overflow-y-auto"
  data-testid="yomitan-kanji-results"
>
  <div class="flex flex-col gap-2.5 p-2.5">
    {#each renderedEntries as renderedEntry (renderedEntry.index)}
      <div use:mountEntryNode={renderedEntry.entryNode}></div>
    {/each}
  </div>
</div>
