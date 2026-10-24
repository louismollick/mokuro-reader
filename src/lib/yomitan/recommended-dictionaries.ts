/** Same-origin static dictionary built by scripts/build-similar-kanji-dictionary.mjs. */
export const SIMILAR_KANJI_DICTIONARY_URL = '/dictionaries/similar-kanji.zip';

/**
 * Install order is profile order. Jiten (Manga) comes first among the frequency dictionaries: it is
 * the default frequency source for segmentation and Common Words (ADR-0001).
 */
export const RECOMMENDED_DICTIONARIES = [
  'https://github.com/stephenmk/stephenmk.github.io/releases/latest/download/jitendex-yomitan.zip',
  'https://github.com/yomidevs/jmdict-yomitan/releases/latest/download/KANJIDIC_english.zip',
  'https://api.jiten.moe/api/frequency-list/download?mediaType=Manga',
  'https://github.com/Kuuuube/yomitan-dictionaries/raw/main/dictionaries/JPDB_v2.2_Frequency_Kana_2024-10-13.zip',
  'https://github.com/MarvNC/yomichan-dictionaries/raw/master/dl/%5BKanji%5D%20JPDB%20Kanji.zip',
  'https://github.com/MarvNC/yomichan-dictionaries/raw/master/dl/%5BKanji%5D%20TheKanjiMap.zip',
  SIMILAR_KANJI_DICTIONARY_URL
] as const;

/** Title of the default frequency dictionary, used for `general.sortFrequencyDictionary`. */
export const JITEN_MANGA_TITLE = 'Jiten (Manga)';

/** Index titles of dictionaries Yomitan's own recommended list doesn't name. */
export const RECOMMENDED_DICTIONARY_TITLES: Partial<Record<string, string>> = {
  'https://api.jiten.moe/api/frequency-list/download?mediaType=Manga': JITEN_MANGA_TITLE,
  'https://github.com/MarvNC/yomichan-dictionaries/raw/master/dl/%5BKanji%5D%20TheKanjiMap.zip':
    'TheKanjiMap Kanji Radicals/Composition',
  [SIMILAR_KANJI_DICTIONARY_URL]: 'Similar Kanji'
};

/** Remote URLs the proxy may fetch; the same-origin static dictionary needs no proxy. */
export const ALLOWED_RECOMMENDED_DICTIONARY_URLS = new Set<string>(
  RECOMMENDED_DICTIONARIES.filter((url) => url !== SIMILAR_KANJI_DICTIONARY_URL)
);

export function buildRecommendedDictionaryProxyUrl(url: string) {
  return `/api/recommended-dictionaries?url=${encodeURIComponent(url)}`;
}
