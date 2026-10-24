import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, waitFor } from '@testing-library/svelte';
import YomitanAnkiFormat from '../YomitanAnkiFormat.svelte';

const mocks = vi.hoisted(() => ({
  connected: false,
  getDeckNames: vi.fn(),
  getModelNames: vi.fn(),
  getModelFieldNames: vi.fn()
}));

const state = vi.hoisted(() => ({
  profile: {
    options: {
      anki: {
        duplicateBehavior: 'new',
        cardFormats: [] as Array<{
          deck: string;
          model: string;
          name: string;
          fields: Record<string, { value: string; overwriteMode: string }>;
        }>
      }
    }
  }
}));

const clientMock = vi.hoisted(() => ({
  profile: { get: vi.fn() },
  anki: { markers: vi.fn() }
}));

vi.mock('$lib/settings', () => ({
  settings: {
    subscribe: (run: (value: object) => void) => {
      run({ ankiConnectSettings: { connectionData: { connected: mocks.connected } } });
      return () => {};
    }
  }
}));
vi.mock('$lib/anki-connect', () => ({
  getDeckNames: mocks.getDeckNames,
  getModelNames: mocks.getModelNames,
  getModelFieldNames: mocks.getModelFieldNames
}));
vi.mock('$lib/yomitan/client', () => ({
  getYomitan: async () => clientMock,
  editProfile: async (edit: (options: unknown) => void) => {
    const profile = structuredClone(state.profile);
    edit(profile.options);
    state.profile = profile;
  }
}));

describe('YomitanAnkiFormat', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.connected = false;
    state.profile = { options: { anki: { duplicateBehavior: 'new', cardFormats: [] } } };
    clientMock.profile.get.mockImplementation(() => structuredClone(state.profile));
    clientMock.anki.markers.mockResolvedValue([]);
    mocks.getDeckNames.mockResolvedValue(['Default', 'Mining']);
    mocks.getModelNames.mockResolvedValue(['Kiku']);
    mocks.getModelFieldNames.mockResolvedValue([
      'Expression',
      'Sentence',
      'Picture',
      'MiscInfo',
      'Other'
    ]);
  });

  it('asks to connect AnkiConnect first when disconnected', () => {
    const { getByText } = render(YomitanAnkiFormat);
    expect(getByText('Connect AnkiConnect first.')).toBeTruthy();
    expect(mocks.getDeckNames).not.toHaveBeenCalled();
  });

  it('writes the recommended Kiku mapping into the profile card format', async () => {
    mocks.connected = true;
    state.profile.options.anki.cardFormats = [
      { deck: 'Mining', model: 'Kiku', name: 'Kiku', fields: {} }
    ];

    const { findByText } = render(YomitanAnkiFormat);
    await findByText('Sentence'); // the note type's fields have loaded
    await fireEvent.click(await findByText('Use recommended Kiku mapping'));

    await waitFor(() =>
      expect(state.profile.options.anki.cardFormats[0].fields).toMatchObject({
        Expression: { value: '{expression}', overwriteMode: 'coalesce' },
        Sentence: { value: '{cloze-prefix}<b>{cloze-body}</b>{cloze-suffix}' },
        Picture: { value: '{screenshot}' },
        MiscInfo: { value: '{series} {volume}' },
        Other: { value: '' }
      })
    );
  });
});
