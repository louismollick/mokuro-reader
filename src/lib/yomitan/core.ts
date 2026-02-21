import type { DictionaryPreference } from './preferences';
import { getCodePointPreview, logYomitanDebug } from './debug';

export interface YomitanDictionarySummary {
  title: string;
  revision: string;
  importDate: number;
  version: number;
  styles?: string;
}

export interface YomitanToken {
  text: string;
  reading: string;
  term: string;
  selectable: boolean;
  kind?: 'word' | 'punct' | 'other';
}

export type YomitanAnkiButtonState =
  | 'checking'
  | 'ready'
  | 'duplicate'
  | 'adding'
  | 'added'
  | 'error'
  | 'unknown';

export interface YomitanAnkiButtonUiState {
  state: YomitanAnkiButtonState;
  disabled?: boolean;
  label?: string;
  title?: string;
}

type SimpleEnabledDictionaryMap = Map<string, { index: number; priority: number }>;

let coreInstance: any | null = null;

async function importCoreIndexModule() {
  return await import('yomitan-core');
}

async function importCoreRenderModule() {
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
    contentBlockCount: parsed.reduce(
      (total, parseResult) => total + (parseResult.content?.length || 0),
      0
    )
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

export async function renderTermEntriesHtml(
  entries: unknown[],
  options?: { showAnkiAddButton?: boolean; ankiButtonStates?: YomitanAnkiButtonUiState[] }
) {
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
    applyPopupTheme: (
      target: HTMLElement,
      options?: { theme?: 'light' | 'dark' | 'browser' | 'site' }
    ) => void;
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

  for (const [index, entry] of entries.entries()) {
    const node = generator.createTermEntry(entry, dictionaryInfo);
    if (options?.showAnkiAddButton) {
      const buttonState = options.ankiButtonStates?.[index];
      const resolvedState = buttonState?.state || 'ready';
      if (resolvedState === 'checking') {
        container.appendChild(node);
        continue;
      }

      node.classList.add('yomitan-entry-with-anki');
      const actionBar = document.createElement('div');
      actionBar.className = 'yomitan-anki-actions';

      const button = document.createElement('button');
      const defaultUi = getDefaultAnkiButtonUiState(resolvedState);
      button.type = 'button';
      button.className = `yomitan-anki-add yomitan-anki-add--${resolvedState} yomitan-anki-add--fade-in`;
      button.dataset.entryIndex = `${index}`;
      button.dataset.state = resolvedState;
      button.disabled = buttonState?.disabled ?? defaultUi.disabled;
      button.title = buttonState?.title ?? defaultUi.title;

      const icon = document.createElement('img');
      icon.className = 'yomitan-anki-icon';
      icon.src = '/brands/anki.svg';
      icon.alt = '';
      icon.setAttribute('aria-hidden', 'true');

      const text = document.createElement('span');
      text.className = 'yomitan-anki-label';
      text.textContent = buttonState?.label ?? defaultUi.label;

      button.appendChild(icon);
      button.appendChild(text);
      actionBar.appendChild(button);

      node.appendChild(actionBar);
    }
    container.appendChild(node);
  }

  const scrollOverrideCss = `
:root {
  --color-primary-600: #ef562f;
  --color-primary-700: #eb4f27;
  --color-blue-600: #2563eb;
  --color-blue-700: #1d4ed8;
  --color-red-600: #dc2626;
  --color-red-700: #b91c1c;
  --color-green-600: #16a34a;
  --color-gray-300: #d1d5db;
  --color-gray-600: #4b5563;
  --color-gray-700: #374151;
}
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
.yomitan-anki-actions {
  position: absolute;
  top: 8px;
  right: 8px;
  z-index: 8;
}
.yomitan-entry-with-anki {
  position: relative;
}
.yomitan-anki-add {
  border: 1px solid var(--color-blue-600);
  background: var(--color-blue-600);
  color: white;
  border-radius: 6px;
  padding: 6px 10px;
  min-width: 120px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
}
.yomitan-anki-icon {
  width: 16px;
  height: 16px;
  display: inline-block;
  object-fit: contain;
}
.yomitan-anki-add--fade-in {
  animation: yomitan-anki-fade-in 180ms ease-out;
}
.yomitan-anki-add--ready {
  border-color: var(--color-blue-600);
  background: var(--color-blue-600);
}
.yomitan-anki-add--ready:hover {
  background: var(--color-blue-700);
}
.yomitan-anki-add--duplicate {
  border-color: var(--color-primary-600);
  background: var(--color-primary-600);
}
.yomitan-anki-add--duplicate:hover {
  background: var(--color-primary-700);
}
.yomitan-anki-add--checking,
.yomitan-anki-add--adding {
  border-color: var(--color-gray-600);
  background: var(--color-gray-700);
  color: var(--color-gray-300);
  cursor: wait;
}
.yomitan-anki-add--checking:hover,
.yomitan-anki-add--adding:hover {
  background: var(--color-gray-700);
}
.yomitan-anki-add--added {
  border-color: var(--color-green-600);
  background: var(--color-green-600);
}
.yomitan-anki-add--added:hover {
  background: var(--color-green-600);
}
.yomitan-anki-add--error {
  border-color: var(--color-red-600);
  background: var(--color-red-600);
}
.yomitan-anki-add--error:hover {
  background: var(--color-red-700);
}
.yomitan-anki-add--unknown {
  border-color: var(--color-blue-600);
  background: var(--color-blue-600);
}
.yomitan-anki-add--unknown:hover {
  background: var(--color-blue-700);
}
.yomitan-anki-add:disabled {
  opacity: 0.95;
}
@keyframes yomitan-anki-fade-in {
  from { opacity: 0; transform: translateY(-2px); }
  to { opacity: 1; transform: translateY(0); }
}
`;

  const heightScript = `
(() => {
  const onClick = (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const button = target.closest('.yomitan-anki-add');
    if (!(button instanceof HTMLElement)) return;
    if ((button instanceof HTMLButtonElement) && button.disabled) return;
    const entryIndex = Number(button.dataset.entryIndex);
    if (Number.isNaN(entryIndex)) return;
    window.parent?.postMessage({ type: 'yomitan-add-note', entryIndex }, '*');
  };

  const sendHeight = () => {
    const height = Math.max(
      document.documentElement?.scrollHeight ?? 0,
      document.body?.scrollHeight ?? 0
    );
    window.parent?.postMessage({ type: 'yomitan-iframe-height', height }, '*');
  };

  window.addEventListener('load', sendHeight);
  window.addEventListener('resize', sendHeight);
  window.addEventListener('click', onClick);
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
    .map(
      ([key, value]) =>
        `data-${key.replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`)}="${value}"`
    )
    .join(' ');

  return `<!doctype html><html ${htmlDataAttributes}><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>${DISPLAY_CSS}</style><style>${scrollOverrideCss}</style></head><body><div id="yomitan-scroll-root">${container.innerHTML}</div><script>${heightScript}<\/script></body></html>`;
}

export function joinTextBoxLines(lines: string[]) {
  return normalizeSourceText(lines);
}

function getDefaultAnkiButtonUiState(state: YomitanAnkiButtonState): {
  label: string;
  title: string;
  disabled: boolean;
} {
  switch (state) {
    case 'checking':
      return {
        label: 'Checking...',
        title: 'Checking Anki for duplicates.',
        disabled: true
      };
    case 'ready':
      return {
        label: 'Add to Anki',
        title: 'Add this entry to Anki.',
        disabled: false
      };
    case 'duplicate':
      return {
        label: 'Add duplicate',
        title: 'Already exists in Anki; adding another copy.',
        disabled: false
      };
    case 'adding':
      return {
        label: 'Adding...',
        title: 'Adding this entry to Anki.',
        disabled: true
      };
    case 'added':
      return {
        label: 'Added \u2713',
        title: 'Added to Anki.',
        disabled: true
      };
    case 'error':
      return {
        label: 'Retry',
        title: 'Last add failed; click to retry.',
        disabled: false
      };
    case 'unknown':
      return {
        label: 'Add to Anki',
        title: 'Could not verify duplicates; add may create a duplicate.',
        disabled: false
      };
  }
}
