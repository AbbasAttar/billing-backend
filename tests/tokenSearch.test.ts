import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/lib/backfillMarker', () => ({ isBackfillDone: async () => true }));

import { tokenSearch } from '../src/services/tokenSearch';
import { buildSearchTokens } from '../src/lib/searchTokens';

/** Fake model: `find` returns docs whose tokens contain the word, capped by `limit`. */
function fakeModel(names: string[]) {
  const docs = names.map((name, i) => ({ _id: String(i), name, searchTokens: buildSearchTokens({ text: [name] }) }));
  const asked: string[] = [];
  const model = {
    find: (filter: any) => {
      const token = filter.searchTokens.$arrayContains;
      asked.push(token);
      let cap = Infinity;
      const q = {
        limit: (n: number) => { cap = n; return q; },
        withHiddenFields: () => q,
        lean: () => Promise.resolve(docs.filter((d) => d.searchTokens.includes(token)).slice(0, cap).map((d) => ({ ...d }))),
      };
      return q;
    },
  };
  return { model: model as any, asked };
}

describe('tokenSearch', () => {
  it('finds a document beyond the cap of a common word by trying the next word', async () => {
    const names = [...Array.from({ length: 150 }, (_, i) => `Rose Attar ${i}`), 'MM Pack Attar'];
    const { model, asked } = fakeModel(names);
    const found = await tokenSearch(model, 'mm pack attar', { marker: 'm', limit: 15 });
    expect(found?.map((d) => d.name)).toEqual(['MM Pack Attar']);
    expect(asked).toEqual(['attar', 'pack']);
  });

  it('reads one word only when it is under the cap', async () => {
    const { model, asked } = fakeModel(['MM Pack Attar', 'Rose Attar']);
    const found = await tokenSearch(model, 'pack attar', { marker: 'm', limit: 15 });
    expect(found?.map((d) => d.name)).toEqual(['MM Pack Attar']);
    expect(asked).toEqual(['attar']);
  });
});
