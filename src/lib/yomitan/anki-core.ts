export async function importCoreAnkiModule() {
  const module = await import('yomitan-core/anki');
  if (typeof (module as any).buildAnkiNoteFromDictionaryEntry !== 'function') {
    throw new Error('Loaded yomitan-core anki module without buildAnkiNoteFromDictionaryEntry.');
  }
  return module;
}
