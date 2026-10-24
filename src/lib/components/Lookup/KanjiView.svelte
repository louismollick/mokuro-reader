<script lang="ts">
  import type { KanjiTerm, Yomitan } from 'yomitan-core';
  import type { KanjiInfo } from '$lib/yomitan/kanji-data';

  interface Props {
    client: Yomitan;
    character: string;
    /** Loads (and caches) what the dictionaries know about a kanji. */
    loadInfo: (character: string) => Promise<KanjiInfo>;
    /** A similar kanji or component was tapped. */
    onKanji: (character: string) => void;
    /** A Common Word was tapped. */
    onWord: (term: string) => void;
  }

  let { client, character, loadInfo, onKanji, onWord }: Props = $props();

  /** Everything the view shows, loaded together so it appears at once. */
  async function load(kanji: string) {
    const info = await loadInfo(kanji);
    const [words, similar, parts] = await Promise.all([
      // The kanji-term index can be busy being built; the view is fine without Words then.
      client.lookup.termsContaining(kanji, { limit: 12 }).catch((): KanjiTerm[] => []),
      Promise.all(info.similar.map(loadInfo)),
      Promise.all(info.components.map(loadInfo))
    ]);
    return { info, words, similar, parts };
  }

  /** The term's characters, with the viewed kanji picked out. */
  const chars = (term: string) => [...term];
</script>

<div lang="ja">
  {#await load(character)}
    <span class="text-[56px] leading-none text-white">{character}</span>
  {:then { info, words, similar, parts }}
    <header class="flex items-start gap-4">
      <span class="text-[56px] leading-none text-white">{character}</span>
      <div class="min-w-0 pt-1">
        {#if info.keyword}
          <p class="text-[16px] font-semibold text-white">{info.keyword}</p>
        {/if}
        {#if info.statsLine}
          <p class="text-[12px] text-[#9a9a9a]">{info.statsLine}</p>
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
          <ul class="flex flex-col">
            {#each words as word, index (index)}
              <li>
                <button type="button" class="word" onclick={() => onWord(word.term)}>
                  <span class="text-[16px] text-white">
                    {#each chars(word.term) as char, index (index)}<span
                        class:text-[#f5c542]={char === character}>{char}</span
                      >{/each}
                  </span>
                  {#if word.reading}<span class="text-[13px] text-[#9a9a9a]">{word.reading}</span
                    >{/if}
                  <span class="ml-auto text-[12px] text-[#666] tabular-nums"
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
                  {#if other.keyword}<span class="text-[11px] text-[#9a9a9a]">{other.keyword}</span
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
                  <span class="inline-block py-1 text-[20px] text-[#9a9a9a]">{part.character}</span>
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
  {/await}
</div>

<style>
  .row {
    display: grid;
    grid-template-columns: 56px 1fr;
    column-gap: 8px;
    align-items: start;
  }

  .label {
    white-space: nowrap;
    padding-top: 3px;
    font-size: 11px;
    font-weight: 600;
    color: #9a9a9a;
  }

  .word {
    display: flex;
    width: 100%;
    min-height: 32px;
    align-items: baseline;
    gap: 8px;
    text-align: left;
  }

  .glyph {
    display: inline-flex;
    min-height: 32px;
    align-items: baseline;
    gap: 4px;
  }

  button:focus-visible {
    outline: 1px solid #f5c542;
  }
</style>
