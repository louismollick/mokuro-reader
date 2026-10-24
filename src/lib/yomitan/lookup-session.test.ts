import { describe, expect, it } from 'vitest';
import {
  backTitle,
  currentView,
  popView,
  pushView,
  selectWord,
  startHistory
} from './lookup-session';

const words = ['大学', 'で', '学ぶ'];
const wordText = (index: number) => words[index];

describe('lookup history', () => {
  it('starts at the Text Box Word View', () => {
    const history = startHistory(0);
    expect(currentView(history)).toEqual({ kind: 'box', wordIndex: 0 });
    expect(backTitle(history, wordText)).toBeNull();
  });

  it('pushes Kanji Views and goes back through them', () => {
    let history = pushView(startHistory(0), { kind: 'kanji', character: '大' });
    history = pushView(history, { kind: 'kanji', character: '犬' });
    expect(backTitle(history, wordText)).toBe('大');
    history = popView(history);
    expect(currentView(history)).toEqual({ kind: 'kanji', character: '大' });
    expect(backTitle(history, wordText)).toBe('大学');
  });

  it('names a standalone Word View by its query', () => {
    const history = pushView(pushView(startHistory(2), { kind: 'term', query: '学校' }), {
      kind: 'kanji',
      character: '校'
    });
    expect(backTitle(history, wordText)).toBe('学校');
  });

  it('never pops the root', () => {
    const root = startHistory(1);
    expect(popView(root)).toBe(root);
  });

  it('switching Word replaces the whole history with the new root', () => {
    expect(selectWord(2)).toEqual([{ kind: 'box', wordIndex: 2 }]);
    expect(selectWord(null)).toEqual([{ kind: 'box', wordIndex: null }]);
  });
});
