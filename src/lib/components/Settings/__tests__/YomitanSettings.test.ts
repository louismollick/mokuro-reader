import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, waitFor } from '@testing-library/svelte';
import YomitanSettings from '../YomitanSettings.svelte';

const settingsMocks = vi.hoisted(() => ({
  settingsStore: {
    subscribe: (run: (value: { yomitanPopupOnTextBoxTap: boolean }) => void) => {
      run({ yomitanPopupOnTextBoxTap: false });
      return () => {};
    }
  },
  updateSetting: vi.fn()
}));

const coreMocks = vi.hoisted(() => ({
  getInstalledDictionaries: vi.fn(),
  importDictionaryZip: vi.fn(),
  deleteDictionary: vi.fn()
}));

const preferenceMocks = vi.hoisted(() => ({
  loadDictionaryPreferences: vi.fn(),
  normalizeDictionaryPreferences: vi.fn(),
  saveDictionaryPreferences: vi.fn(),
  moveDictionaryPreference: vi.fn((prefs, from, to) => {
    const next = [...prefs];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    return next;
  })
}));

vi.mock('$lib/settings', () => ({
  settings: settingsMocks.settingsStore,
  updateSetting: settingsMocks.updateSetting
}));

vi.mock('$lib/yomitan/core', () => coreMocks);
vi.mock('$lib/yomitan/preferences', () => preferenceMocks);
vi.mock('$lib/util/snackbar', () => ({ showSnackbar: vi.fn() }));
vi.mock('$lib/util/progress-tracker', () => ({
  progressTrackerStore: { addProcess: vi.fn(), updateProcess: vi.fn(), removeProcess: vi.fn() }
}));
vi.mock('$lib/util', () => ({
  promptConfirmation: (_message: string, callback: () => void) => callback()
}));

describe('YomitanSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    coreMocks.getInstalledDictionaries.mockResolvedValue([
      { title: 'JMdict', importDate: Date.now(), revision: '1', version: 3 },
      { title: 'KANJIDIC', importDate: Date.now() - 1, revision: '1', version: 3 }
    ]);
    preferenceMocks.loadDictionaryPreferences.mockReturnValue([
      { title: 'JMdict', enabled: true },
      { title: 'KANJIDIC', enabled: true }
    ]);
    preferenceMocks.normalizeDictionaryPreferences.mockImplementation((_installed, existing) => existing);
    coreMocks.importDictionaryZip.mockResolvedValue({});
  });

  it('updates popup setting toggle', async () => {
    const { getByText, container } = render(YomitanSettings);
    await waitFor(() => expect(getByText('Installed dictionaries')).toBeTruthy());

    const checkbox = container.querySelector(
      'input[type="checkbox"]'
    ) as HTMLInputElement;
    checkbox.checked = true;
    await fireEvent.change(checkbox);

    expect(settingsMocks.updateSetting).toHaveBeenCalledWith('yomitanPopupOnTextBoxTap', true);
  });

  it('imports uploaded zip dictionaries', async () => {
    const { container } = render(YomitanSettings);
    await waitFor(() => expect(coreMocks.getInstalledDictionaries).toHaveBeenCalled());

    const input = container.querySelector('#yomitan-dictionary-upload') as HTMLInputElement;
    const file = new File([new Uint8Array([1, 2, 3])], 'dict.zip', { type: 'application/zip' });

    await fireEvent.change(input, {
      target: { files: [file] }
    });

    await waitFor(() => expect(coreMocks.importDictionaryZip).toHaveBeenCalled());
  });
});
