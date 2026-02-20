import { describe, expect, it } from 'vitest';
import { migrateProfiles } from './settings';

describe('migrateProfiles', () => {
  it('adds yomitanPopupOnTextBoxTap default for existing profiles', () => {
    const migrated = migrateProfiles({
      LegacyProfile: {
        defaultFullscreen: true
      } as any
    });

    expect(migrated.LegacyProfile.yomitanPopupOnTextBoxTap).toBe(false);
    expect(migrated.LegacyProfile.ankiConnectSettings.popupDeckName).toBe('Default');
    expect(migrated.LegacyProfile.ankiConnectSettings.popupModelName).toBe('Basic');
    expect(migrated.LegacyProfile.ankiConnectSettings.popupFieldMappings).toEqual({});
    expect(migrated.LegacyProfile.ankiConnectSettings.popupDuplicateBehavior).toBe('new');
  });
});
