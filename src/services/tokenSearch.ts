import type { IFirestoreModel } from '../lib/firestoreModel';
import { isBackfillDone } from '../lib/backfillMarker';
import { matchesAllWords, parseSearchQuery } from '../lib/searchTokens';

/** Documents fetched per search before narrowing in memory (multi-word queries, archived rows). */
const FETCH_CAP = 100;

export const SEARCH_MARKERS = {
  customers: 'searchTokens_customers',
  frames: 'searchTokens_frames',
  fragrances: 'searchTokens_fragrances',
  opticallens: 'searchTokens_opticallens',
  contactlens: 'searchTokens_contactlens',
} as const;

export interface TokenSearchOptions {
  /** Backfill marker name; until the backfill ran, null is returned so the caller can use the legacy search. */
  marker: string;
  limit: number;
  /** Extra in-memory condition, e.g. "not archived". */
  predicate?: (doc: any) => boolean;
}

/**
 * Search through the `searchTokens` array: one array-contains query on the most selective word,
 * then every other word is verified against the document's tokens. Reads about `limit` documents
 * instead of the whole collection.
 *
 * Returns null when the tokens are not backfilled yet (use the legacy search), [] when the query
 * is too short to search.
 */
export async function tokenSearch(
  model: IFirestoreModel,
  q: unknown,
  options: TokenSearchOptions,
): Promise<any[] | null> {
  if (!(await isBackfillDone(options.marker))) return null;

  const parsed = parseSearchQuery(q);
  if (!parsed) return [];

  const docs: any[] = await model
    .find({ searchTokens: { $arrayContains: parsed.token } })
    .limit(FETCH_CAP)
    .withHiddenFields()
    .lean();

  return docs
    .filter((d) => matchesAllWords(d.searchTokens, parsed.words) && (!options.predicate || options.predicate(d)))
    .slice(0, options.limit)
    .map((d) => {
      delete d.searchTokens;
      return d;
    });
}
