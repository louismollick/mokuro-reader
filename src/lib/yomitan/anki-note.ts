import { get } from 'svelte/store';
import { ankiConnect, resolveDynamicTags, syncAnkiWeb, type VolumeMetadata } from '$lib/anki-connect';
import { settings } from '$lib/settings';
import { getInstalledDictionaries } from '$lib/yomitan/core';
import { importCoreAnkiModule } from '$lib/yomitan/anki-core';

export async function getPopupFieldMarkers(): Promise<string[]> {
  const ankiModule = await importCoreAnkiModule();
  const standard =
    typeof ankiModule.getStandardFieldMarkers === 'function'
      ? ankiModule.getStandardFieldMarkers('term', 'ja')
      : [];

  const installed = await getInstalledDictionaries();
  const dynamic = typeof ankiModule.getDynamicFieldMarkers === 'function'
    ? ankiModule.getDynamicFieldMarkers(
        installed.map((item) => ({ name: item.title, enabled: true })),
        installed
      )
    : [];

  return [...new Set([...standard, ...dynamic])].sort((a, b) => a.localeCompare(b));
}

export async function buildPopupAnkiNote(
  dictionaryEntry: unknown,
  sourceText: string,
  metadata?: VolumeMetadata
) {
  const ankiSettings = get(settings).ankiConnectSettings;
  const {
    popupDeckName,
    popupModelName,
    popupFieldMappings,
    tags,
    popupDuplicateBehavior: _popupDuplicateBehavior
  } = ankiSettings;

  const mappedFields = Object.fromEntries(
    Object.entries(popupFieldMappings)
      .map(([key, value]) => [key.trim(), value.trim()])
      .filter(([key, value]) => key.length > 0 && value.length > 0)
      .map(([key, value]) => [key, { value }])
  );

  if (Object.keys(mappedFields).length === 0) {
    throw new Error('No popup field mappings configured. Configure fields in Settings > Anki Connect.');
  }

  if (!popupModelName?.trim()) {
    throw new Error('No popup model configured. Configure model in Settings > Anki Connect.');
  }

  const resolvedDeckName = metadata ? resolveDynamicTags(popupDeckName, metadata) : popupDeckName;
  const resolvedTags = metadata ? resolveDynamicTags(tags || '', metadata) : tags || '';
  const tagList = resolvedTags
    .split(' ')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);

  const ankiModule = await importCoreAnkiModule();
  const installed = await getInstalledDictionaries();
  const dictionaryStylesMap = new Map<string, string>(
    installed
      .map((item) => [item.title, item.styles ?? ''] as const)
      .filter(([, styles]) => styles.length > 0)
  );
  const dynamicTemplates =
    typeof ankiModule.getDynamicTemplates === 'function'
      ? ankiModule.getDynamicTemplates(
          installed.map((item) => ({ name: item.title, enabled: true })),
          installed
        )
      : '';
  const template =
    typeof ankiModule.getDefaultAnkiFieldTemplates === 'function'
      ? ankiModule.getDefaultAnkiFieldTemplates(dynamicTemplates)
      : undefined;
  const result = await ankiModule.buildAnkiNoteFromDictionaryEntry({
    dictionaryEntry,
    cardFormat: {
      deck: resolvedDeckName || 'Default',
      model: popupModelName,
      fields: mappedFields
    },
    context: {
      url: window.location.href,
      query: sourceText,
      fullQuery: sourceText,
      documentTitle: document.title
    },
    tags: tagList,
    duplicateScope: 'collection',
    duplicateScopeCheckAllModels: false,
    resultOutputMode: 'split',
    glossaryLayoutMode: 'default',
    compactTags: false,
    template,
    dictionaryStylesMap
  });

  return result;
}

export async function addPopupAnkiNote(
  dictionaryEntry: unknown,
  sourceText: string,
  metadata?: VolumeMetadata
) {
  const result = await buildPopupAnkiNote(dictionaryEntry, sourceText, metadata);
  await ankiConnect('createDeck', { deck: result.note.deckName });
  const noteId = await ankiConnect('addNote', { note: result.note });
  if (!noteId) {
    throw new Error('Failed to add note to Anki.');
  }
  await syncAnkiWeb();

  return {
    noteId,
    errors: result.errors
  };
}
