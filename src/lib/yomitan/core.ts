import type { DictionaryPreference } from './preferences';
import { getCodePointPreview, logYomitanDebug } from './debug';

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
  selectable: boolean;
  kind?: 'word' | 'punct' | 'other';
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
  logYomitanDebug('core', 'tokenize:start', {
    textLength: text.length,
    textPreview: text.slice(0, 80),
    textCodePoints: getCodePointPreview(text),
    enabledDictionaryCount: parserDictionaryMap.size,
    enabledDictionaryNames: [...parserDictionaryMap.keys()]
  });

  const parsed = (await core.parseText(text, {
    language: 'ja',
    enabledDictionaryMap: parserDictionaryMap,
    scanLength: 10,
    searchResolution: 'letter',
    removeNonJapaneseCharacters: false,
    deinflect: true,
    textReplacements: [null]
  })) as Array<{
    content?: Array<Array<{ text?: string; reading?: string; headwords?: unknown[][] }>>;
  }>;
  logYomitanDebug('core', 'tokenize:parseText-complete', {
    parseResultCount: parsed.length,
    contentBlockCount: parsed.reduce((total, parseResult) => total + (parseResult.content?.length || 0), 0)
  });

  const tokens: YomitanToken[] = [];
  for (const parseResult of parsed) {
    const lines = parseResult.content || [];
    for (const line of lines) {
      for (const segment of line) {
        if (!segment.text) continue;
        const tokenText = segment.text.trim();
        if (!tokenText) continue;

        const selectable = Array.isArray(segment.headwords) && segment.headwords.length > 0;

        tokens.push({
          text: tokenText,
          reading: segment.reading || '',
          term: tokenText,
          selectable,
          kind: selectable ? 'word' : 'other'
        });
      }
    }
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
  const {
    DisplayGenerator,
    DISPLAY_TEMPLATES,
    DISPLAY_CSS,
    NoOpContentManager,
    applyExtensionDisplayDefaults,
    applyPopupTheme
  } = renderModule as {
    DisplayGenerator: new (doc: Document, contentManager: unknown, templateHtml: string) => any;
    DISPLAY_TEMPLATES: string;
    DISPLAY_CSS: string;
    NoOpContentManager: new () => unknown;
    applyExtensionDisplayDefaults: (target: HTMLElement) => void;
    applyPopupTheme: (target: HTMLElement, options?: { theme?: 'light' | 'dark' | 'browser' | 'site' }) => void;
  };

  const themeTarget = document.createElement('div');
  applyExtensionDisplayDefaults(themeTarget);
  applyPopupTheme(themeTarget, { theme: 'dark' });
  themeTarget.dataset.pageType = 'popup';
  themeTarget.dataset.theme = 'dark';
  themeTarget.dataset.themeRaw = 'dark';
  themeTarget.dataset.browserTheme = 'dark';
  themeTarget.dataset.siteTheme = 'dark';

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
  background-color: #1e1e1e;
  color: #d4d4d4;
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
  background-color: #1e1e1e;
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

  const htmlDataAttributes = Object.entries(themeTarget.dataset)
    .map(([key, value]) => `data-${key.replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`)}="${value}"`)
    .join(' ');

  return `<!doctype html><html ${htmlDataAttributes}><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>${DISPLAY_CSS}</style><style>${scrollOverrideCss}</style></head><body><div id="yomitan-scroll-root">${container.innerHTML}</div><script>${heightScript}<\/script></body></html>`;
}

export function joinTextBoxLines(lines: string[]) {
  return normalizeSourceText(lines);
}
