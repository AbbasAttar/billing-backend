import type { BeforeWriteContext } from './firestoreModel';

/**
 * Search tokens: a `searchTokens` string array on each searchable document, queried with
 * Firestore `array-contains`. A search then reads only the matching documents, where the old
 * `$regex` search downloaded the whole collection on every keystroke.
 *
 * Matching covers word prefixes ("ab" finds "Abbas") and any inner substring of 3+ letters or
 * 4+ digits ("bba", the middle of a phone number), like the old substring search did. Single
 * letters and a 2-letter match in the middle of a word are not searchable.
 */

const MIN_PREFIX = 2;
const MAX_PREFIX = 15;
const MAX_TOKENS = 500;

/** Lowercase, strip accents and punctuation, collapse whitespace. */
export function normalizeText(input: unknown): string {
  return String(input ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function wordPrefixes(word: string): string[] {
  const out: string[] = [];
  const max = Math.min(word.length, MAX_PREFIX);
  for (let len = MIN_PREFIX; len <= max; len++) out.push(word.slice(0, len));
  return out;
}

export interface TokenSource {
  /** Free text: word prefixes (2+ letters) and inner substrings (3+ letters). */
  text?: unknown[];
  /** Phone numbers: prefixes (3+ digits) and inner substrings (4+ digits). */
  numbers?: unknown[];
  /** Codes searched as typed (frame codes): prefixes (3+) and inner substrings (4+). */
  codes?: unknown[];
}

function substrings(value: string, minLen: number, startAtOne: boolean): string[] {
  const out: string[] = [];
  for (let start = startAtOne ? 1 : 0; start < value.length; start++) {
    const maxLen = Math.min(MAX_PREFIX, value.length - start);
    for (let len = minLen; len <= maxLen; len++) out.push(value.slice(start, start + len));
  }
  return out;
}

export function buildSearchTokens(source: TokenSource): string[] {
  // Prefixes first, so they survive the MAX_TOKENS cap ahead of the inner substrings.
  const prefixes = new Set<string>();
  const inner = new Set<string>();

  for (const value of source.text ?? []) {
    for (const word of normalizeText(value).split(' ')) {
      if (word.length === 1) prefixes.add(word);
      else if (word.length > 1) {
        wordPrefixes(word).forEach((t) => prefixes.add(t));
        substrings(word, 3, true).forEach((t) => inner.add(t));
      }
    }
  }

  for (const value of source.numbers ?? []) {
    const digits = String(value ?? '').replace(/\D/g, '');
    if (!digits) continue;
    for (let len = 3; len <= Math.min(digits.length, MAX_PREFIX); len++) prefixes.add(digits.slice(0, len));
    substrings(digits, 4, true).forEach((t) => inner.add(t));
  }

  for (const value of source.codes ?? []) {
    const code = normalizeText(value).replace(/ /g, '');
    if (!code) continue;
    for (let len = 3; len <= Math.min(code.length, MAX_PREFIX); len++) prefixes.add(code.slice(0, len));
    substrings(code, 4, true).forEach((t) => inner.add(t));
  }

  return [...new Set([...prefixes, ...inner])].slice(0, MAX_TOKENS);
}

export interface ParsedQuery {
  /** Token to send to Firestore array-contains (the most selective word). */
  token: string;
  /** Every normalized query word; documents must contain all of them as tokens. */
  words: string[];
}

/** Turns what the user typed into a Firestore token plus the words to verify in memory. */
export function parseSearchQuery(q: unknown): ParsedQuery | null {
  const text = normalizeText(q);
  if (text.length < 2) return null;
  // One-letter words ("a", "j") are only tokens when they stand alone, so they cannot be verified.
  const words = text.split(' ').filter((w) => w.length >= MIN_PREFIX).map((w) => w.slice(0, MAX_PREFIX));
  if (words.length === 0) return null;
  const token = [...words].sort((a, b) => b.length - a.length)[0];
  return { token, words };
}

/** True when a document's tokens contain every query word. */
export function matchesAllWords(tokens: unknown, words: string[]): boolean {
  if (!Array.isArray(tokens)) return false;
  const set = new Set(tokens as string[]);
  return words.every((w) => set.has(w));
}

type TokenExtractor = (doc: Record<string, any>) => TokenSource;

/**
 * `beforeWrite` hook that maintains `searchTokens`. Full writes recompute from the payload; partial
 * updates recompute (merged with the stored document) only when a searchable field changed.
 */
export function searchTokenHook(fields: string[], extract: TokenExtractor) {
  return async (payload: Record<string, any>, ctx: BeforeWriteContext): Promise<void> => {
    if (ctx.full) {
      payload.searchTokens = buildSearchTokens(extract(payload));
      return;
    }
    if (!fields.some((f) => f in payload)) return;
    const merged = { ...((await ctx.getExisting()) ?? {}), ...payload };
    payload.searchTokens = buildSearchTokens(extract(merged));
  };
}
