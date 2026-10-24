<script lang="ts">
  import { onDestroy } from 'svelte';

  interface Props {
    /** The Text Box's Words in reading order; unmatched spans have no entries. */
    words: { text: string; matched: boolean }[];
    selected: number | null;
    /** A matched Word was tapped: switch the Word View to it. */
    onSelect: (index: number) => void;
    /** The user selected text in the strip (the escape hatch for a wrong split). */
    onSelectText: (text: string) => void;
  }

  let { words, selected, onSelect, onSelectText }: Props = $props();

  let strip: HTMLDivElement | undefined = $state();
  let settleTimer: ReturnType<typeof setTimeout> | undefined;

  /** The strip's own selected text, if any. */
  function selectedText() {
    const selection = window.getSelection();
    if (!strip || !selection || selection.isCollapsed) return '';
    if (!strip.contains(selection.anchorNode) || !strip.contains(selection.focusNode)) return '';
    return selection.toString().replace(/\s+/g, '');
  }

  // A selection is final once it stops changing: long-press handles on iOS and drags on desktop
  // fire `selectionchange` all along.
  function handleSelectionChange() {
    clearTimeout(settleTimer);
    if (!selectedText()) return;
    settleTimer = setTimeout(() => {
      const text = selectedText();
      if (!text) return;
      window.getSelection()?.removeAllRanges();
      onSelectText(text);
    }, 450);
  }

  function select(index: number) {
    // The click that ends a drag-selection is not a tap on the Word.
    if (!selectedText()) onSelect(index);
  }

  onDestroy(() => clearTimeout(settleTimer));
</script>

<svelte:document onselectionchange={handleSelectionChange} />

<div bind:this={strip} class="strip" lang="ja">
  {#each words as word, index (index)}
    {#if word.matched}
      <!-- Not focusable: a focusable span can't start a drag-selection in Chromium. -->
      <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
      <span class="word" class:selected={selected === index} onclick={() => select(index)}
        >{word.text}</span
      >
    {:else}
      <span class="text-[#666]">{word.text}</span>
    {/if}
  {/each}
</div>

<style>
  .strip {
    font-size: 16px;
    line-height: 2;
    user-select: text;
    -webkit-user-select: text;
  }

  .word {
    color: #bbb;
    cursor: pointer;
    text-decoration: underline;
    text-decoration-color: #333;
    text-decoration-thickness: 1px;
    text-underline-offset: 4px;
  }

  .word.selected {
    color: #fff;
    text-decoration-color: #f5c542;
    text-decoration-thickness: 2px;
  }

  .word:focus-visible {
    outline: 1px solid #f5c542;
  }
</style>
