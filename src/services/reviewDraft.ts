import Anthropic from '@anthropic-ai/sdk';
import { env } from '../config/env';

const MODEL = 'claude-haiku-4-5-20251001';

let _client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!_client) _client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  return _client;
}

export interface ReviewDraftInput {
  rating: number;
  /** What the customer bought, as they picked it on the bill page ("Ray-Ban frame", "attar"). */
  items: string[];
  /** What they liked ("Friendly staff", "Quick service"). */
  aspects: string[];
  /** Earlier drafts for this bill, so a retry reads differently. */
  avoid?: string[];
}

// The customer edits and posts the text themselves on Google; the draft must only restate what they picked.
const SYSTEM_PROMPT = `You help a customer of Attarwala Optical House, an optical and fragrance shop in Dahod, Gujarat (since 1959), put their own experience into words for a Google review.

Write ONE review in the customer's voice (first person), from only the facts given: the star rating, what they bought, and what they liked.
- Do not invent anything else: no staff names, prices, discounts, dates, comparisons with other shops, or medical claims.
- 2 to 3 short sentences, 25–55 words, plain everyday Indian English, specific to what they bought. Not marketing copy: no superlatives like "best in town", "top-notch", "exceptional", "highly recommend", "hassle-free".
- Vary the opening and structure; do not start with "I recently" or "Great experience".
- Match the tone to the stars. 5: warm and happy. 4: positive but measured. 3: mixed, "okay overall". 1–2: polite and disappointed, without inventing any complaint; mention only what they bought and anything they liked.
- No emojis, no hashtags, no quotation marks.
Return only the review text.`;

/** Plain sentences from the picked facts, for when the AI is unavailable. */
export function templateReviewDraft({ rating, items, aspects }: ReviewDraftInput, seed = Date.now()): string {
  const pick = <T,>(list: T[]) => list[Math.abs(seed) % list.length];
  const bought = items.length ? items.slice(0, 3).join(', ').replace(/, ([^,]*)$/, ' and $1') : 'my purchase';
  const liked = aspects.map((a) => a.toLowerCase());
  const likedText = liked.length ? liked.slice(0, 3).join(', ').replace(/, ([^,]*)$/, ' and $1') : '';

  const openers = rating >= 5
    ? [`Bought ${bought} from Attarwala Optical House and I am very happy.`, `Very happy with ${bought} from Attarwala Optical House, Dahod.`, `Got ${bought} here and it was a really good experience.`]
    : rating === 4
    ? [`Bought ${bought} from Attarwala Optical House, good experience overall.`, `Good experience getting ${bought} at Attarwala Optical House.`]
    : rating === 3
    ? [`Bought ${bought} from Attarwala Optical House. Okay experience overall.`, `Got ${bought} here, it was okay.`]
    : [`Bought ${bought} from Attarwala Optical House. My experience was not as good as I expected.`];
  const middles = likedText
    ? [`Liked the ${likedText}.`, `What I liked most: ${likedText}.`]
    : [''];
  const closers = rating >= 5
    ? ['Recommended for anyone in Dahod.', 'Will come back again.', 'Thank you to the team.']
    : rating === 4
    ? ['Would visit again.', 'Satisfied with the service.']
    : ['Hope it is better next time.'];

  return [pick(openers), pick(middles), pick(closers)].filter(Boolean).join(' ');
}

/** A Google-review draft for the given star rating; falls back to a template when the AI is off or fails. */
export async function generateReviewDraft(input: ReviewDraftInput): Promise<{ text: string; ai: boolean }> {
  if (!env.ANTHROPIC_API_KEY) return { text: templateReviewDraft(input), ai: false };

  try {
    const prompt = [
      `Star rating: ${input.rating} of 5`,
      `Bought: ${input.items.length ? input.items.join('; ') : 'not specified'}`,
      `Liked: ${input.aspects.length ? input.aspects.join('; ') : 'not specified'}`,
      input.avoid?.length ? `Write it differently from these earlier drafts:\n${input.avoid.map((d) => `- ${d}`).join('\n')}` : null,
    ].filter(Boolean).join('\n');

    const response = await getClient().messages.create({
      model: MODEL,
      max_tokens: 200,
      system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: prompt }],
    });
    const text = response.content
      .filter((b) => b.type === 'text')
      .map((b) => (b as Anthropic.TextBlock).text)
      .join('')
      .trim()
      .replace(/^["“]|["”]$/g, '');
    return text ? { text, ai: true } : { text: templateReviewDraft(input), ai: false };
  } catch (err) {
    console.warn('[reviewDraft] AI draft failed, using template:', (err as Error).message);
    return { text: templateReviewDraft(input), ai: false };
  }
}
