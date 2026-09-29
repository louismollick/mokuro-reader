import { describe, expect, it } from 'vitest';
import type { AnkiConnectSettings } from '$lib/settings/settings';
import type { Profile } from 'yomitan-core';
import {
  applyLegacySettingsToProfile,
  applyPendingDictionaryPreference
} from './profile-migration';

function baseAnkiSettings(overrides: Partial<AnkiConnectSettings> = {}): AnkiConnectSettings {
  return {
    url: 'http://127.0.0.1:8765',
    enabled: true,
    connectionData: null,
    androidModeOverride: 'auto',
    selectedModel: '',
    createModelConfigs: {},
    updateModelConfigs: {},
    heightField: 0,
    widthField: 0,
    qualityField: 1,
    cropImage: false,
    triggerMethod: 'both',
    cardMode: 'create',
    quickCapture: false,
    tags: '{series}',
    popupDeckName: 'Mokuro',
    popupModelName: 'Basic',
    popupFieldMappings: {},
    popupDuplicateBehavior: 'new',
    ...overrides
  };
}

function baseProfile(): Profile {
  return {
    version: 42,
    options: {
      general: { popupTheme: 'light' },
      dictionaries: [],
      anki: {
        enable: false,
        server: 'http://127.0.0.1:8765',
        tags: [],
        screenshot: { format: 'png', quality: 92 },
        cardFormats: [],
        duplicateScope: 'collection',
        duplicateScopeCheckAllModels: false,
        duplicateBehavior: 'new',
        checkForDuplicates: true,
        fieldTemplates: null,
        suspendNewCards: false,
        displayTagsAndFlags: 'never',
        targetTags: [],
        noteGuiMode: 'browse',
        apiKey: '',
        downloadTimeout: 0,
        forceSync: false,
        noteDupeCheckFirst: false
      }
    }
    // Only the keys this migration touches are populated; the rest of ProfileOptions is out of
    // scope for this unit test, so the object is cast rather than fully constructed.
  } as unknown as Profile;
}

describe('applyLegacySettingsToProfile', () => {
  it('converts popup field mappings into cardFormats[0], skipping maindefinition', () => {
    const profile = baseProfile();
    const anki = baseAnkiSettings({
      popupFieldMappings: {
        Expression: '{expression}',
        Reading: '{reading}',
        MainDefinition: '{glossary}',
        Blank: '   '
      }
    });

    const result = applyLegacySettingsToProfile(profile, anki);

    expect(result.options.anki.cardFormats).toEqual([
      {
        type: 'term',
        name: 'Basic',
        deck: 'Mokuro',
        model: 'Basic',
        fields: {
          Expression: { value: '{expression}', overwriteMode: 'coalesce' },
          Reading: { value: '{reading}', overwriteMode: 'coalesce' }
        },
        icon: 'big-circle'
      }
    ]);
  });

  it('leaves cardFormats untouched when there is nothing to migrate', () => {
    const profile = baseProfile();
    const anki = baseAnkiSettings({ popupModelName: '', popupFieldMappings: {} });

    const result = applyLegacySettingsToProfile(profile, anki);

    expect(result.options.anki.cardFormats).toEqual([]);
  });

  it('splits the tags string into an array', () => {
    const profile = baseProfile();
    const anki = baseAnkiSettings({ tags: '{series}  mokuro  ' });

    const result = applyLegacySettingsToProfile(profile, anki);

    expect(result.options.anki.tags).toEqual(['{series}', 'mokuro']);
  });

  it('carries popupDuplicateBehavior into anki.duplicateBehavior', () => {
    const profile = baseProfile();
    const anki = baseAnkiSettings({ popupDuplicateBehavior: 'new' });

    const result = applyLegacySettingsToProfile(profile, anki);

    expect(result.options.anki.duplicateBehavior).toBe('new');
  });

  it('forces the dark popup theme', () => {
    const result = applyLegacySettingsToProfile(baseProfile(), baseAnkiSettings());

    expect(result.options.general.popupTheme).toBe('dark');
  });
});

describe('applyPendingDictionaryPreference', () => {
  function profileWith(...entries: Array<[string, boolean]>): Profile {
    const profile = baseProfile();
    profile.options.dictionaries = entries.map(([name, enabled]) => ({ name, enabled })) as never;
    return profile;
  }

  it('applies the legacy disabled flag to a re-imported dictionary and consumes it', () => {
    const profile = profileWith(['JMdict', true], ['KANJIDIC', true]);
    const pending = [
      { title: 'JMdict', enabled: false },
      { title: 'KANJIDIC', enabled: true }
    ];

    const result = applyPendingDictionaryPreference(profile, 'JMdict', pending);

    expect(profile.options.dictionaries.map((d) => [d.name, d.enabled])).toEqual([
      ['JMdict', false],
      ['KANJIDIC', true]
    ]);
    expect(result.changed).toBe(true);
    expect(result.pending).toEqual([{ title: 'KANJIDIC', enabled: true }]);
  });

  it('ignores dictionaries with no pending preference', () => {
    const profile = profileWith(['NewDict', true]);
    const pending = [{ title: 'JMdict', enabled: false }];

    const result = applyPendingDictionaryPreference(profile, 'NewDict', pending);

    expect(result.changed).toBe(false);
    expect(result.pending).toBe(pending);
    expect(profile.options.dictionaries[0].enabled).toBe(true);
  });
});
