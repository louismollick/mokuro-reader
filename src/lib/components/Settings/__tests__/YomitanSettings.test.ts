import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, waitFor } from '@testing-library/svelte';
import YomitanSettings from '../YomitanSettings.svelte';
import { JITEN_MANGA_TITLE, RECOMMENDED_DICTIONARIES } from '$lib/yomitan/recommended-dictionaries';

const settingsMocks = vi.hoisted(() => ({
  settingsStore: {
    subscribe: (run: (value: object) => void) => {
      run({ yomitanPopupOnTextBoxTap: false, ankiConnectSettings: { connectionData: null } });
      return () => {};
    }
  },
  updateSetting: vi.fn()
}));

const state = vi.hoisted(() => ({
  profile: {
    options: {
      dictionaries: [] as Array<{ name: string; enabled: boolean }>,
      general: { sortFrequencyDictionary: null as string | null }
    }
  }
}));

const clientMock = vi.hoisted(() => ({
  profile: {
    get: vi.fn(),
    set: vi.fn(),
    syncDictionaries: vi.fn()
  },
  dictionaries: {
    list: vi.fn(),
    import: vi.fn(),
    delete: vi.fn(),
    recommended: vi.fn()
  }
}));

vi.mock('$lib/settings', () => ({
  settings: settingsMocks.settingsStore,
  updateSetting: settingsMocks.updateSetting
}));

vi.mock('$lib/anki-connect', () => ({
  getDeckNames: vi.fn(),
  getModelNames: vi.fn(),
  getModelFieldNames: vi.fn()
}));

vi.mock('$lib/yomitan/client', () => ({
  getYomitan: async () => clientMock,
  editProfile: async (edit: (options: unknown) => void) => {
    const profile = clientMock.profile.get();
    edit(profile.options);
    await clientMock.profile.set(profile);
  }
}));
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
    state.profile = {
      options: {
        dictionaries: [
          { name: 'JMdict', enabled: true },
          { name: 'KANJIDIC', enabled: true }
        ],
        general: { sortFrequencyDictionary: null }
      }
    };
    clientMock.profile.get.mockImplementation(() => structuredClone(state.profile));
    clientMock.profile.set.mockImplementation(async (next: typeof state.profile) => {
      state.profile = structuredClone(next);
      return next;
    });
    clientMock.profile.syncDictionaries.mockResolvedValue(state.profile);
    clientMock.dictionaries.list.mockResolvedValue([]);
    clientMock.dictionaries.import.mockResolvedValue({ title: 'x' });
    clientMock.dictionaries.delete.mockResolvedValue(undefined);
    clientMock.dictionaries.recommended.mockResolvedValue([]);
  });

  it('updates popup setting toggle', async () => {
    const { getByText, container } = render(YomitanSettings);
    await waitFor(() => expect(getByText('JMdict')).toBeTruthy());

    const checkbox = container.querySelector('input[type="checkbox"]') as HTMLInputElement;
    checkbox.checked = true;
    await fireEvent.change(checkbox);

    expect(settingsMocks.updateSetting).toHaveBeenCalledWith('yomitanPopupOnTextBoxTap', true);
  });

  it('imports uploaded zip dictionaries through the client', async () => {
    const { container } = render(YomitanSettings);
    await waitFor(() => expect(clientMock.profile.syncDictionaries).toHaveBeenCalled());

    const input = container.querySelector('#yomitan-dictionary-upload') as HTMLInputElement;
    const file = new File([new Uint8Array([1, 2, 3])], 'dict.zip', { type: 'application/zip' });

    await fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() =>
      expect(clientMock.dictionaries.import).toHaveBeenCalledWith(
        expect.objectContaining({ source: file, onProgress: expect.any(Function) })
      )
    );
  });

  it('toggles and reorders through the profile', async () => {
    const { getAllByText, getByText } = render(YomitanSettings);
    await waitFor(() => expect(getByText('JMdict')).toBeTruthy());

    await fireEvent.click(getAllByText('Down')[0]);
    await waitFor(() =>
      expect(state.profile.options.dictionaries.map((item) => item.name)).toEqual([
        'KANJIDIC',
        'JMdict'
      ])
    );

    const checkbox = getAllByText('Enabled')[0].closest('label')?.querySelector('input');
    await fireEvent.change(checkbox as HTMLInputElement, { target: { checked: false } });
    await waitFor(() => expect(state.profile.options.dictionaries[0].enabled).toBe(false));
  });

  it('deletes through the client', async () => {
    const { getAllByText, getByText } = render(YomitanSettings);
    await waitFor(() => expect(getByText('JMdict')).toBeTruthy());

    await fireEvent.click(getAllByText('Delete')[0]);

    await waitFor(() => expect(clientMock.dictionaries.delete).toHaveBeenCalledWith('JMdict'));
  });

  it('imports recommended dictionaries by URL, using the listed name when available', async () => {
    clientMock.dictionaries.recommended.mockResolvedValue([
      { name: 'Jitendex', downloadUrl: RECOMMENDED_DICTIONARIES[0] },
      { name: 'Unrelated', downloadUrl: 'https://example.com/other.zip' }
    ]);
    // Jitendex is installed up front; Jiten (Manga) is there once the imports are done.
    clientMock.dictionaries.list
      .mockResolvedValueOnce([{ title: 'Jitendex' }])
      .mockResolvedValue([{ title: 'Jitendex' }, { title: JITEN_MANGA_TITLE }]);

    const { getByText } = render(YomitanSettings);
    await waitFor(() => expect(getByText('JMdict')).toBeTruthy());

    await fireEvent.click(getByText('Install recommended dictionaries'));

    await waitFor(() =>
      expect(clientMock.dictionaries.import).toHaveBeenCalledTimes(
        RECOMMENDED_DICTIONARIES.length - 1
      )
    );
    const urls = clientMock.dictionaries.import.mock.calls.map(([options]) => options.source.url);
    // Jitendex is already installed; the rest (listed or not) import from their URLs.
    expect(urls).toEqual(RECOMMENDED_DICTIONARIES.slice(1));
    // Jiten (Manga) is the first frequency dictionary and becomes the sort frequency source.
    expect(urls.indexOf(RECOMMENDED_DICTIONARIES[2])).toBeLessThan(
      urls.findIndex((url) => url.includes('JPDB_v2.2_Frequency'))
    );
    await waitFor(() =>
      expect(state.profile.options.general.sortFrequencyDictionary).toBe(JITEN_MANGA_TITLE)
    );
  });

  it('keeps a frequency dictionary the user already chose', async () => {
    state.profile.options.general.sortFrequencyDictionary = 'JPDBv2㋕';
    clientMock.dictionaries.list.mockResolvedValue([{ title: JITEN_MANGA_TITLE }]);

    const { getByText } = render(YomitanSettings);
    await waitFor(() => expect(getByText('JMdict')).toBeTruthy());

    await fireEvent.click(getByText('Install recommended dictionaries'));

    // The profile edit runs after the last import.
    await waitFor(() => expect(clientMock.profile.set).toHaveBeenCalled());
    expect(state.profile.options.general.sortFrequencyDictionary).toBe('JPDBv2㋕');
  });
});
