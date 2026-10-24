/**
 * Builds the "Similar Kanji" Yomitan kanji dictionary (static/dictionaries/similar-kanji.zip).
 * Similar Kanji = kanji that look like a given kanji and are easy to confuse with it.
 *
 * Usage: node scripts/build-similar-kanji-dictionary.mjs [kikuKanjiDb] [kanjiumLookalikes] [yenckenJson] [out] [kanjidicDir]
 *
 * Inputs are data only (parsed, never executed):
 *  - kikuKanjiDb: gzipped JSON, kanji -> tuple whose index 8 is the WaniKani visuallySimilar list
 *  - kanjiumLookalikes: TSV, "kanji<TAB>a,b,c"
 *  - yenckenJson: JSON, kanji -> [{ kan, score }] sorted by score desc (stroke edit distance)
 *  - kanjidicDir: unzipped KANJIDIC Yomitan dictionary; its `freq` stat (newspaper rank) breaks
 *    Yencken score ties, most common first, kanji without a rank last
 *
 * Merge per kanji: WaniKani, then Kanjium, then (only while under MIN_LIST) Yencken neighbors with
 * score >= YENCKEN_MIN_SCORE (ties by frequency); deduped, self dropped, capped at MAX_LIST. Directionality is kept.
 */
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { BlobWriter, TextReader, ZipWriter } from '@zip.js/zip.js';
import { createMemoryStorage, createZipArchiveReader, importDictionaryArchive } from 'yomitan-core';

const MIN_LIST = 3;
const MAX_LIST = 6;
const YENCKEN_MIN_SCORE = 0.8;
const WANIKANI_VISUALLY_SIMILAR_INDEX = 8;

const [kikuPath, kanjiumPath, yenckenPath, outPath, kanjidicDir] = [
  process.argv[2] ?? `${homedir()}/code/kiku/packages/note/.db/kiku_db_kanji_compact.json.gz`,
  process.argv[3] ?? '/tmp/kanji-dicts/kanjium/lookalikes.txt',
  process.argv[4] ?? '/tmp/kanji-dicts/yencken/s.json',
  process.argv[5] ?? 'static/dictionaries/similar-kanji.zip',
  process.argv[6] ?? '/tmp/kanji-dicts/kanjidic'
];

/** True for exactly one Unicode code point (a single kanji). */
const isSingleChar = (value) => typeof value === 'string' && [...value].length === 1;

const wanikani = new Map();
const kikuDb = JSON.parse(gunzipSync(readFileSync(kikuPath)).toString('utf8'));
for (const [kanji, info] of Object.entries(kikuDb)) {
  const list = info[WANIKANI_VISUALLY_SIMILAR_INDEX];
  if (Array.isArray(list)) wanikani.set(kanji, list.filter(isSingleChar));
}

const kanjium = new Map();
for (const line of readFileSync(kanjiumPath, 'utf8').split(/\r?\n/)) {
  if (!line || line.startsWith('#')) continue;
  const [kanji, rest = ''] = line.split('\t');
  kanjium.set(
    kanji,
    rest
      .split(',')
      .map((item) => item.trim())
      .filter(isSingleChar)
  );
}

/** KANJIDIC newspaper frequency rank per kanji (1 = most common). */
const frequencyRank = new Map();
for (const file of readdirSync(kanjidicDir).filter((name) => /^kanji_bank_\d+\.json$/.test(name))) {
  for (const [kanji, , , , , stats] of JSON.parse(readFileSync(join(kanjidicDir, file), 'utf8'))) {
    const rank = Number(stats?.freq);
    if (rank > 0) frequencyRank.set(kanji, rank);
  }
}
const rankOf = (kanji) => frequencyRank.get(kanji) ?? Infinity;

const yencken = new Map();
for (const [kanji, neighbors] of Object.entries(JSON.parse(readFileSync(yenckenPath, 'utf8')))) {
  yencken.set(
    kanji,
    neighbors
      .filter(({ score }) => score >= YENCKEN_MIN_SCORE)
      .sort((a, b) => b.score - a.score || rankOf(a.kan) - rankOf(b.kan))
      .map(({ kan }) => kan)
  );
}

/** Merges one kanji's lists from all sources; returns the list and the source of each entry. */
function merge(kanji) {
  const result = [];
  const add = (source, items, limit = MAX_LIST) => {
    for (const item of items) {
      if (result.length >= limit) return;
      if (item === kanji || result.some((entry) => entry.kanji === item)) continue;
      result.push({ kanji: item, source });
    }
  };
  add('wanikani', wanikani.get(kanji) ?? []);
  add('kanjium', kanjium.get(kanji) ?? []);
  add('yencken', yencken.get(kanji) ?? [], MIN_LIST);
  return result;
}

const allKanji = new Set(
  [...wanikani.keys(), ...kanjium.keys(), ...yencken.keys()].filter(isSingleChar)
);
const merged = new Map();
for (const kanji of allKanji) {
  const list = merge(kanji);
  if (list.length > 0) merged.set(kanji, list);
}

const revision = new Date().toISOString().slice(0, 10);
const index = {
  title: 'Similar Kanji',
  revision,
  format: 3,
  author: 'mokuro-reader',
  description:
    "Kanji that look like a given kanji and are easy to confuse with it. Sources: WaniKani visually similar kanji (data scraped via Kiku); Kanjium lookalikes (CC BY-SA 4.0); stroke edit distance neighbors from Lars Yencken's PhD datasets.",
  attribution: 'WaniKani, Kanjium (CC BY-SA 4.0), Lars Yencken'
};
// One meaning per similar kanji so Yomitan's kanji view lists them one by one.
const kanjiBank = [...merged].map(([kanji, list]) => [
  kanji,
  '',
  '',
  '',
  list.map((entry) => entry.kanji),
  {}
]);

const zipWriter = new ZipWriter(new BlobWriter('application/zip'));
const lastModDate = new Date(`${revision}T00:00:00Z`);
await zipWriter.add('index.json', new TextReader(JSON.stringify(index)), { lastModDate });
await zipWriter.add('kanji_bank_1.json', new TextReader(JSON.stringify(kanjiBank)), {
  lastModDate
});
const zip = new Uint8Array(await (await zipWriter.close()).arrayBuffer());

// Validate with Yomitan's own importer (checks index and kanji bank against its schemas).
const storage = createMemoryStorage();
await storage.prepare();
const { result, errors } = await importDictionaryArchive(storage, createZipArchiveReader(zip));
if (!result || errors.length > 0) {
  throw new Error(`Yomitan rejected the dictionary: ${errors.map((e) => e.message).join('; ')}`);
}

mkdirSync(dirname(resolve(outPath)), { recursive: true });
writeFileSync(outPath, zip);

const sourceCounts = { wanikani: 0, kanjium: 0, yencken: 0 };
for (const list of merged.values()) for (const { source } of list) sourceCounts[source]++;
const total = [...merged.values()].reduce((sum, list) => sum + list.length, 0);
console.log(`Wrote ${outPath} (${(zip.length / 1024).toFixed(1)} KB), imported OK`);
console.log(`kanji: ${merged.size}, avg list length: ${(total / merged.size).toFixed(2)}`);
console.log('entries per source:', sourceCounts);
for (const kanji of [...'学語待間晴日目白未人力']) {
  console.log(
    kanji,
    merged
      .get(kanji)
      ?.map((entry) => `${entry.kanji}(${entry.source[0]})`)
      .join(' ') ?? '-'
  );
}
