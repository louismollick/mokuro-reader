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
  });
});

