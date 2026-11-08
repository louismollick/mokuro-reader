<script lang="ts">
  import type { KanjiData } from '$lib/yomitan/lookup-loader';

  interface Props {
    /** Everything the view shows, loaded before it is mounted (`lookup-loader.ts`). */
    data: KanjiData;
    /** A similar kanji or component was tapped. */
    onKanji: (character: string) => void;
    /** A Common Word was tapped. */
    onWord: (term: string) => void;
  }

  let { data, onKanji, onWord }: Props = $props();

  let { info, words, similar, parts } = $derived(data);
  let character = $derived(info.character);
</script>

<div lang="ja">
  <header class="flex items-start gap-4">
    <span class="text-[56px] leading-none text-white">{character}</span>
    <div class="min-w-0 pt-1">
      {#if info.keyword}
        <p class="text-[16px] font-semibold text-white">{info.keyword}</p>
      {/if}
      {#if info.statsLine}
        <p class="text-[12px] text-gray-400">{info.statsLine}</p>
      {/if}
      {#if info.readings.length > 0}
        <p class="text-[13px] text-white">
          {info.readings
            .map(({ reading, percent }) => (percent ? `${reading} ${percent}%` : reading))
            .join(' · ')}
        </p>
      {/if}
    </div>
  </header>

  <div class="mt-4 flex flex-col gap-3">
    {#if words.length > 0}
      <div class="row">
        <span class="label">Words</span>
        <ul class="flex min-w-0 flex-col">
          {#each words as word, index (index)}
            <li>
              <button type="button" class="word" onclick={() => onWord(word.term)}>
                <span class="shrink-0 text-[16px] text-white">
                  {#each [...word.term] as char, index (index)}<span
                      class:text-primary-500={char === character}>{char}</span
                    >{/each}
                </span>
                {#if word.reading && word.reading !== word.term}<span
                    class="shrink-0 text-[12px] text-gray-400">{word.reading}</span
                  >{/if}
                <span class="gloss" lang="en">{word.gloss}</span>
                <span class="shrink-0 text-[11px] text-gray-500 tabular-nums"
                  >{word.frequency.toLocaleString('en-US')}</span
                >
              </button>
            </li>
          {/each}
        </ul>
      </div>
    {/if}

    {#if similar.length > 0}
      <div class="row">
        <span class="label">Similar</span>
        <ul class="flex flex-wrap gap-x-4 gap-y-1">
          {#each similar as other, index (index)}
            <li>
              <button type="button" class="glyph" onclick={() => onKanji(other.character)}>
                <span class="text-[20px] text-white">{other.character}</span>
                {#if other.keyword}<span class="text-[11px] text-gray-400">{other.keyword}</span
                  >{/if}
              </button>
            </li>
          {/each}
        </ul>
      </div>
    {/if}

    {#if parts.length > 0}
      <div class="row">
        <span class="label">Parts</span>
        <ul class="flex flex-wrap gap-x-4 gap-y-1">
          {#each parts as part, index (index)}
            <li>
              {#if part.known}
                <button type="button" class="glyph" onclick={() => onKanji(part.character)}>
                  <span class="text-[20px] text-white">{part.character}</span>
                </button>
              {:else}
                <span class="inline-block py-1 text-[20px] text-gray-400">{part.character}</span>
              {/if}
            </li>
          {/each}
        </ul>
      </div>
    {/if}

    {#if info.meanings.length > 0}
      <div class="row">
        <span class="label">Meanings</span>
        <p class="text-[13px] text-white">{info.meanings.join(', ')}</p>
      </div>
    {/if}
  </div>
</div>

<style>
  .row {
    display: grid;
    grid-template-columns: 56px minmax(0, 1fr);
    column-gap: 8px;
    align-items: start;
  }

  .label {
    white-space: nowrap;
    padding-top: 3px;
    font-size: 11px;
    font-weight: 600;
    color: var(--color-gray-400);
  }

  .word {
    display: flex;
    width: 100%;
    min-height: 32px;
    align-items: baseline;
    gap: 8px;
    text-align: left;
  }

  /* One line: the word and its reading stay whole, the meaning gives way. */
  .gloss {
    min-width: 0;
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 13px;
    color: var(--color-gray-300);
  }

  .glyph {
    display: inline-flex;
    min-height: 32px;
    align-items: baseline;
    gap: 4px;
  }

  button:focus-visible {
    outline: 1px solid var(--color-primary-500);
  }
</style>
