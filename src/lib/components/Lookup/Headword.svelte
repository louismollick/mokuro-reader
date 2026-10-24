<script lang="ts">
  import type { TermDictionaryEntry } from 'yomitan-core';
  import {
    distributeFurigana,
    frequencyLabels,
    inflectionNames,
    primaryPitchPositions
  } from '$lib/yomitan/entry-data';
  import { pitchMorae } from '$lib/yomitan/pitch';

  interface Props {
    entry: TermDictionaryEntry;
    /** The text that was looked up, for the inflection line (`食べなかった ← negative · past`). */
    surface: string;
    /** Peek: only the first frequency dictionary. */
    compact: boolean;
    /** A kanji of the headword was tapped. */
    onKanji: (character: string) => void;
  }

  let { entry, surface, compact, onKanji }: Props = $props();

  let headword = $derived(entry.headwords[0]);
  let segments = $derived(distributeFurigana(headword.term, headword.reading));
  let reading = $derived(headword.reading || headword.term);
  let pitches = $derived(primaryPitchPositions(entry));
  let frequencies = $derived(compact ? frequencyLabels(entry).slice(0, 1) : frequencyLabels(entry));
  let inflections = $derived(inflectionNames(entry));

  const isKanji = (char: string) => /\p{Script=Han}/u.test(char) && char !== '々';
</script>

<div class="min-w-0" lang="ja">
  <div class="flex flex-wrap items-end gap-x-3 gap-y-1">
    <span class="text-[26px] leading-[1.9] font-semibold text-white">
      {#each segments as segment, index (index)}
        <ruby
          >{#each [...segment.text] as char, charIndex (charIndex)}{#if isKanji(char)}<button
                type="button"
                class="kanji"
                aria-label={`Kanji ${char}`}
                onclick={() => onKanji(char)}>{char}</button
              >{:else}{char}{/if}{/each}{#if segment.reading}<rt
              class="text-[11px] font-normal text-[#9a9a9a]">{segment.reading}</rt
            >{/if}</ruby
        >
      {/each}
    </span>

    {#each pitches as position (position)}
      <span class="pitch text-[12px] whitespace-nowrap text-[#ccc]">
        {#each pitchMorae(reading, position) as mora, index (index)}<span
            class:high={mora.high}
            class:downstep={mora.downstep}>{mora.text}</span
          >{/each}<span class="ml-0.5 text-[#9a9a9a]">[{position}]</span>
      </span>
    {/each}
  </div>

  {#if frequencies.length > 0}
    <p class="flex flex-wrap gap-x-3 text-[12px] text-[#9a9a9a]">
      {#each frequencies as frequency, index (index)}
        <span
          ><span class="font-semibold text-white tabular-nums">{frequency.value}</span>
          {frequency.name}</span
        >
      {/each}
    </p>
  {/if}

  {#if inflections.length > 0}
    <p class="text-[12px] text-[#9a9a9a]">{surface} ← {inflections.join(' · ')}</p>
  {/if}
</div>

<style>
  .kanji {
    all: unset;
    cursor: pointer;
    border-bottom: 1px dotted #666;
  }

  .kanji:focus-visible {
    outline: 1px solid #f5c542;
  }

  /* High morae get an overline; the mora before the drop also gets the downstep tick. */
  .pitch span.high {
    border-top: 1px solid #fff;
  }

  .pitch span.high.downstep {
    border-right: 1px solid #fff;
  }
</style>
