import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, waitFor } from '@testing-library/svelte';
import YomitanDrawer from './YomitanDrawer.svelte';

const coreMocks = vi.hoisted(() => ({
  getInstalledDictionaries: vi.fn(),
  buildEnabledDictionaryMap: vi.fn(),
  tokenizeText: vi.fn(),
  lookupTerm: vi.fn(),
  renderTermEntriesHtml: vi.fn()
}));

const preferenceMocks = vi.hoisted(() => ({
  loadDictionaryPreferences: vi.fn(),
  normalizeDictionaryPreferences: vi.fn(),
  saveDictionaryPreferences: vi.fn()
}));

vi.mock('$lib/yomitan/core', () => coreMocks);
vi.mock('$lib/yomitan/preferences', () => preferenceMocks);

describe('YomitanDrawer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    coreMocks.getInstalledDictionaries.mockResolvedValue([{ title: 'JMdict', importDate: Date.now() }]);
    preferenceMocks.loadDictionaryPreferences.mockReturnValue([{ title: 'JMdict', enabled: true }]);
    preferenceMocks.normalizeDictionaryPreferences.mockReturnValue([{ title: 'JMdict', enabled: true }]);
    coreMocks.buildEnabledDictionaryMap.mockReturnValue(
      new Map([['JMdict', { index: 0, priority: 0 }]])
    );
  });

  it('renders token buttons and dictionary iframe after token click', async () => {
    coreMocks.tokenizeText.mockResolvedValue([{ text: '日本語', reading: 'にほんご', term: '日本語' }]);
    coreMocks.lookupTerm.mockResolvedValue({ entries: [{ id: 1 }], originalTextLength: 3 });
    coreMocks.renderTermEntriesHtml.mockResolvedValue('<html><body><div>result</div></body></html>');

    const { getByText, container } = render(YomitanDrawer, {
      open: true,
      sourceText: '日本語'
    });

    await waitFor(() => expect(getByText('日本語')).toBeTruthy());

    await fireEvent.click(getByText('日本語'));

    await waitFor(() => {
      const iframe = container.querySelector('iframe');
      expect(iframe).toBeTruthy();
      expect((iframe as HTMLIFrameElement).srcdoc).toContain('result');
    });
  });

  it('shows no entries message when lookup returns empty entries', async () => {
    coreMocks.tokenizeText.mockResolvedValue([{ text: '猫', reading: 'ねこ', term: '猫' }]);
    coreMocks.lookupTerm.mockResolvedValue({ entries: [], originalTextLength: 1 });

    const { getByText } = render(YomitanDrawer, {
      open: true,
      sourceText: '猫'
    });

    await waitFor(() => expect(getByText('猫')).toBeTruthy());
    await fireEvent.click(getByText('猫'));

    await waitFor(() =>
      expect(getByText('No dictionary entries found for this token.')).toBeTruthy()
    );
  });
});

