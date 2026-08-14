import type {
  DictionarySelection,
  InstalledDictionary,
  KanjiDictionaryEntry,
  TermDictionaryEntry,
  YomitanClient
} from 'yomitan-core';
import {
  createKanjiEntryRenderer as createCoreKanjiEntryRenderer,
  createTermEntryRenderer as createCoreTermEntryRenderer
} from 'yomitan-core/render';
import type {
  KanjiEntryRenderer,
  RenderHostOptions,
  RenderedKanjiEntry,
  RenderedTermEntry,
  TermEntryRenderer,
  KanjiEntryRendererCreateOptions,
  PopupTheme,
  TermEntryRendererCreateOptions
} from 'yomitan-core/render';
import type { DictionaryPreference } from './preferences';
import { getCodePointPreview, logYomitanDebug } from './debug';

export type YomitanDictionarySummary = InstalledDictionary;

export interface YomitanToken {
  text: string;
  reading: string;
  term: string;
  selectable: boolean;
  kind?: 'word' | 'punct' | 'other';
}

export type YomitanPopupTheme = PopupTheme;

export type YomitanRenderHostOptions = RenderHostOptions;
export type YomitanRenderedTermEntry = RenderedTermEntry;
export type YomitanRenderedKanjiEntry = RenderedKanjiEntry;
export type YomitanTermEntryRenderer = TermEntryRenderer;
export type YomitanKanjiEntryRenderer = KanjiEntryRenderer;
export type YomitanTermEntryRendererCreateOptions = TermEntryRendererCreateOptions;
export type YomitanKanjiEntryRendererCreateOptions = KanjiEntryRendererCreateOptions;

let coreInstance: YomitanClient | null = null;

async function importCoreIndexModule() {
  return await import('yomitan-core');
}

async function getCoreInstance() {
  if (coreInstance) return coreInstance;

  const module = await importCoreIndexModule();
  const core = module.createYomitan({
    storage: new module.DictionaryDB('mokuro-reader-yomitan'),
    initLanguage: true
  });
  await core.initialize();
  coreInstance = core;
  return coreInstance;
}

function normalizeSourceText(lines: string[]) {
  return lines
    .map((line) => line.trim())
    .filter(Boolean)
    .join('')
    .replace(/\s+/g, '')
    .trim();
}

export function buildEnabledDictionaries(preferences: DictionaryPreference[]) {
  return preferences
    .filter((item) => item.enabled)
    .map<DictionarySelection>((item, index) => ({
      id: item.title,
      index,
      priority: 0,
      alias: item.title,
      allowSecondarySearches: false,
      partsOfSpeechFilter: true,
      useDeinflections: true
    }));
}

export function buildEnabledKanjiDictionaries(
  preferences: DictionaryPreference[],
  installedDictionaries: YomitanDictionarySummary[]
) {
  const installedDictionaryMap = new Map(
    installedDictionaries.map((dictionary) => [dictionary.title, dictionary])
  );
  const dictionaries: DictionarySelection[] = [];
  let index = 0;

  for (const preference of preferences) {
    if (!preference.enabled) continue;

    const installedDictionary = installedDictionaryMap.get(preference.title);
    if (!installedDictionary || (installedDictionary.counts?.kanji?.total ?? 0) <= 0) {
      continue;
    }

    dictionaries.push({
      id: preference.title,
      index,
      alias: preference.title
    });
    index += 1;
  }

  return dictionaries;
}

export async function getInstalledDictionaries(): Promise<YomitanDictionarySummary[]> {
  const core = await getCoreInstance();
  const dictionaries = await core.dictionaries.list();
  return [...dictionaries].sort((a, b) => b.importDate - a.importDate);
}

export async function importDictionaryZip(
  archive: ArrayBuffer,
  onProgress?: (progress: { index: number; count: number; nextStep?: boolean }) => void
) {
  const core = await getCoreInstance();
  return await core.dictionaries.import({
    source: archive,
    onProgress
  });
}

export async function deleteDictionary(title: string) {
  const core = await getCoreInstance();
  await core.dictionaries.remove(title);
}

export async function tokenizeText(text: string, dictionaries: DictionarySelection[]) {
  const core = await getCoreInstance();
  logYomitanDebug('core', 'tokenize:start', {
    textLength: text.length,
    textPreview: text.slice(0, 80),
    textCodePoints: getCodePointPreview(text),
    enabledDictionaryCount: dictionaries.length,
    enabledDictionaryNames: dictionaries.map(({ id }) => id)
  });

  const scannedTokens = await core.lookup.scanLine({
    text,
    language: 'ja',
    dictionaries,
    options: {
      scanLength: 10,
      searchResolution: 'letter',
      removeNonJapaneseCharacters: false,
      deinflect: true,
      textReplacements: [null]
    }
  });

  logYomitanDebug('core', 'tokenize:scanLine-complete', {
    tokenCount: scannedTokens.length
  });

  const tokens: YomitanToken[] = [];
  for (const token of scannedTokens) {
    const tokenText = token.text.trim();
    if (!tokenText) continue;

    tokens.push({
      text: tokenText,
      reading: token.reading,
      term: tokenText,
      selectable: token.selectable,
      kind: token.selectable ? 'word' : 'other'
    });
  }

  logYomitanDebug('core', 'tokenize:complete', {
    tokenCount: tokens.length,
    selectableCount: tokens.filter((token) => token.selectable).length,
    tokenPreview: tokens.slice(0, 10).map((token) => ({
      text: token.text,
      selectable: token.selectable,
      reading: token.reading
    }))
  });

  return tokens;
}

export async function lookupTerm(text: string, dictionaries: DictionarySelection[]) {
  const core = await getCoreInstance();
  const result = (await core.lookup.terms({
    text,
    language: 'ja',
    dictionaries,
    options: {
      mode: 'group',
      matchType: 'exact',
      deinflect: true,
      removeNonJapaneseCharacters: false,
      searchResolution: 'letter'
    }
  })) as { entries: TermDictionaryEntry[]; originalTextLength: number };

  return result;
}

export async function lookupKanji(text: string, dictionaries: DictionarySelection[]) {
  const core = await getCoreInstance();
  return (await core.lookup.kanji({
    text,
    dictionaries,
    removeNonJapaneseCharacters: true
  })) as KanjiDictionaryEntry[];
}

export function createTermEntryRenderer(
  options?: YomitanTermEntryRendererCreateOptions
): YomitanTermEntryRenderer {
  return createCoreTermEntryRenderer(options);
}

export function createKanjiEntryRenderer(
  options?: YomitanKanjiEntryRendererCreateOptions
): YomitanKanjiEntryRenderer {
  return createCoreKanjiEntryRenderer(options);
}

export function joinTextBoxLines(lines: string[]) {
  return normalizeSourceText(lines);
}
