const YOMITAN_CORE_ANKI_CANDIDATES = [
  '/@fs/Users/mollicl/yomitan-core/src/anki/index.ts',
  '/@fs/Users/mollicl/mokuro-reader/node_modules/yomitan-core/src/anki/index.ts',
  '/@id/yomitan-core/anki',
  '/@fs/Users/mollicl/yomitan-core/dist/anki.js',
  '/@fs/Users/mollicl/mokuro-reader/node_modules/yomitan-core/dist/anki.js'
];

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

export async function importCoreAnkiModule() {
  const module = await tryImport(YOMITAN_CORE_ANKI_CANDIDATES);
  if (typeof (module as any).buildAnkiNoteFromDictionaryEntry !== 'function') {
    throw new Error('Loaded yomitan-core anki module without buildAnkiNoteFromDictionaryEntry.');
  }
  return module;
}
