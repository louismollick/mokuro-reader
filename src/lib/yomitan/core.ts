import type { DictionaryPreference } from './preferences';

export interface YomitanDictionarySummary {
  title: string;
  revision: string;
  importDate: number;
  version: number;
}

export interface YomitanToken {
  text: string;
  reading: string;
  term: string;
}

type SimpleEnabledDictionaryMap = Map<string, { index: number; priority: number }>;

const YOMITAN_CORE_INDEX_CANDIDATES = [
  '/@fs/Users/mollicl/yomitan-core/dist/index.js',
  '/@fs/Users/mollicl/yomitan-core/src/index.ts'
];

const YOMITAN_CORE_RENDER_CANDIDATES = [
  '/@fs/Users/mollicl/yomitan-core/dist/render.js',
  '/@fs/Users/mollicl/yomitan-core/src/render/index.ts'
];

let coreInstance: any | null = null;

async function tryImport(specifiers: string[]) {
  let lastError: unknown = null;

  for (const specifier of specifiers) {
    try {
      return await import(/* @vite-ignore */ specifier);
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError ?? new Error(`Failed to import module candidates: ${specifiers.join(', ')}`);
}

async function importCoreIndexModule() {
  if (import.meta.env.DEV) {
    try {
      return await tryImport(YOMITAN_CORE_INDEX_CANDIDATES);
    } catch {
      // Fall back to package import below.
    }
  }

  // Use a literal specifier so Vite can resolve and bundle it for production.
  return await import('yomitan-core');
}

async function importCoreRenderModule() {
  if (import.meta.env.DEV) {
    try {
      return await tryImport(YOMITAN_CORE_RENDER_CANDIDATES);
    } catch {
      // Fall back to package import below.
    }
  }

  // Use a literal specifier so Vite can resolve and bundle it for production.
  return await import('yomitan-core/render');
}

async function getCoreInstance() {
  if (coreInstance) return coreInstance;

  const module = await importCoreIndexModule();
  const YomitanCore = module.default;
  const core = new YomitanCore({
    databaseName: 'mokuro-reader-yomitan',
    initLanguage: true
  });
  await core.initialize();
  coreInstance = core;
  return coreInstance;
}

function toFindTermDictionaryMap(enabledDictionaryMap: SimpleEnabledDictionaryMap) {
  const map = new Map<
    string,
    {
      index: number;
      alias: string;
      allowSecondarySearches: boolean;
      partsOfSpeechFilter: boolean;
      useDeinflections: boolean;
    }
  >();

  for (const [name, { index }] of enabledDictionaryMap.entries()) {
    map.set(name, {
      index,
      alias: name,
      allowSecondarySearches: false,
      partsOfSpeechFilter: true,
      useDeinflections: true
    });
  }

  return map;
}

function normalizeSourceText(lines: string[]) {
  return lines
    .map((line) => line.trim())
    .filter(Boolean)
    .join('')
    .replace(/\s+/g, '')
    .trim();
}

export function buildEnabledDictionaryMap(preferences: DictionaryPreference[]) {
  const enabled = preferences.filter((item) => item.enabled);
  const map: SimpleEnabledDictionaryMap = new Map();

  enabled.forEach((item, index) => {
    map.set(item.title, {
      index,
      priority: 0
    });
  });

  return map;
}

export async function getInstalledDictionaries(): Promise<YomitanDictionarySummary[]> {
  const core = await getCoreInstance();
  const dictionaries = (await core.getDictionaryInfo()) as YomitanDictionarySummary[];
  return [...dictionaries].sort((a, b) => b.importDate - a.importDate);
}

export async function importDictionaryZip(
  archive: ArrayBuffer,
  onProgress?: (progress: { index: number; count: number; nextStep?: boolean }) => void
) {
  const core = await getCoreInstance();
  return await core.importDictionary(archive, {
    onProgress
  });
}

export async function deleteDictionary(title: string) {
  const core = await getCoreInstance();
  await core.deleteDictionary(title);
}

export async function tokenizeText(text: string, enabledDictionaryMap: SimpleEnabledDictionaryMap) {
  const core = await getCoreInstance();
  const parserDictionaryMap = toFindTermDictionaryMap(enabledDictionaryMap);

  const parsed = (await core.parseText(text, {
    language: 'ja',
    enabledDictionaryMap: parserDictionaryMap,
    scanLength: 10,
    searchResolution: 'letter',
    removeNonJapaneseCharacters: false,
    deinflect: true,
    textReplacements: [null]
  })) as Array<{ segments?: Array<{ text?: string; reading?: string; term?: string }> }>;

  const tokens: YomitanToken[] = [];
  for (const line of parsed) {
    const segments = line.segments || [];
    for (const segment of segments) {
      if (!segment.text) continue;
      const tokenText = segment.text.trim();
      if (!tokenText) continue;

      tokens.push({
        text: tokenText,
        reading: segment.reading || '',
        term: segment.term || tokenText
      });
    }
  }
  return tokens;
}

export async function lookupTerm(text: string, enabledDictionaryMap: SimpleEnabledDictionaryMap) {
  const core = await getCoreInstance();
  const result = (await core.findTerms(text, {
    mode: 'group',
    language: 'ja',
    enabledDictionaryMap: toFindTermDictionaryMap(enabledDictionaryMap),
    options: {
      matchType: 'exact',
      deinflect: true,
      removeNonJapaneseCharacters: false,
      searchResolution: 'letter'
    }
  })) as { entries: unknown[]; originalTextLength: number };

  return result;
}

export async function renderTermEntriesHtml(entries: unknown[]) {
  const core = await getCoreInstance();
  const dictionaryInfo = await core.getDictionaryInfo();

  const renderModule = await importCoreRenderModule();
  const { DisplayGenerator, DISPLAY_TEMPLATES, DISPLAY_CSS, NoOpContentManager } = renderModule as {
    DisplayGenerator: new (doc: Document, contentManager: unknown, templateHtml: string) => any;
    DISPLAY_TEMPLATES: string;
    DISPLAY_CSS: string;
    NoOpContentManager: new () => unknown;
  };

  const generator = new DisplayGenerator(document, new NoOpContentManager(), DISPLAY_TEMPLATES);
  const container = document.createElement('div');
  container.className = 'yomitan-results';

  for (const entry of entries) {
    const node = generator.createTermEntry(entry, dictionaryInfo);
    container.appendChild(node);
  }

  const scrollOverrideCss = `
html, body {
  height: 100%;
}
body {
  margin: 0;
  overflow: hidden !important;
}
#yomitan-scroll-root {
  height: 100vh;
  overflow-y: auto;
  overflow-x: hidden;
  -webkit-overflow-scrolling: touch;
}
`;

  const heightScript = `
(() => {
  const sendHeight = () => {
    const height = Math.max(
      document.documentElement?.scrollHeight ?? 0,
      document.body?.scrollHeight ?? 0
    );
    window.parent?.postMessage({ type: 'yomitan-iframe-height', height }, '*');
  };

  window.addEventListener('load', sendHeight);
  window.addEventListener('resize', sendHeight);
  setTimeout(sendHeight, 0);
  setTimeout(sendHeight, 50);
  setTimeout(sendHeight, 250);

  if (typeof ResizeObserver !== 'undefined' && document.body) {
    const observer = new ResizeObserver(sendHeight);
    observer.observe(document.body);
  }
})();
`;

  return `<!doctype html><html data-frequency-display-mode="split-tags"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>${DISPLAY_CSS}</style><style>${scrollOverrideCss}</style></head><body><div id="yomitan-scroll-root">${container.innerHTML}</div><script>${heightScript}<\/script></body></html>`;
}

export function joinTextBoxLines(lines: string[]) {
  return normalizeSourceText(lines);
}
