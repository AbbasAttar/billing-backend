import Anthropic from '@anthropic-ai/sdk';
import { env } from '../config/env';

const MODEL = 'claude-haiku-4-5-20251001';

// Singleton client — created once per process
let _client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!_client) _client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  return _client;
}

// ── Segment descriptions used in the prompt ───────────────────────────────────

const SEGMENT_CONTEXT: Record<string, string> = {
  lost: 'customers who have not purchased in over 6 months and need a win-back message',
  atRisk: 'customers who are overdue for a visit and may churn if not re-engaged soon',
  vip: 'high-value loyal customers with a history of large purchases who deserve VIP treatment',
  new: 'customers who made their first purchase within the last 30 days and need a warm welcome',
  crossSell: 'customers who have purchased frames or lenses but have never tried the fragrance range, or vice versa',
  highDiscount: 'customers who always ask for heavy discounts and need to be introduced to better value alternatives',
};

const CHANNEL_CONTEXT: Record<string, string> = {
  whatsapp: 'WhatsApp message (conversational, personal, under 300 characters ideally)',
  sms: 'SMS (very short, under 160 characters, no emojis)',
  email: 'email body (can be longer, 2-3 short paragraphs)',
  manual: 'WhatsApp message (conversational, personal, under 300 characters)',
};

const CAMPAIGN_TYPE_CONTEXT: Record<string, string> = {
  recovery: 'win-back / recovery — re-engage lapsed customers',
  upgrade: 'upsell / upgrade — encourage existing customers to try premium products',
  launch: 'new product announcement',
  festival: 'festive season greeting with an offer',
  birthday: 'birthday wish with a special offer',
  custom: 'general outreach',
};

export interface GenerateCopyInput {
  campaignType: string;
  channel: string;
  segmentKey: string;
  tone?: 'friendly' | 'formal' | 'festive';
  extraInstructions?: string;
}

export interface GenerateCopyResult {
  copy: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
}

// ── System prompt (cached) ────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a marketing copywriter for Attarwala Optical House (AOH), a premium optical and fragrance boutique in India. The business sells eyeglass frames, prescription optical lenses, and luxury fragrances.

Your job is to write short, personal, and effective outreach messages that feel human — not like a mass blast. Messages should:
- Open with "Hi {name}!" (the {name} placeholder will be replaced with the customer's actual name at send time)
- Sound warm and genuine, not salesy
- Be written in simple, clear English (the audience is Indian customers familiar with conversational English)
- Reference Attarwala Optical House by name at least once
- End with a soft call-to-action (visit us, reply, etc.) — no pressure
- Never mention specific prices or discounts unless the campaign type requires it
- For WhatsApp and manual channels: keep it under 300 characters where possible
- For SMS: stay under 160 characters, no emojis
- For email: write 2-3 short paragraphs, can use light formatting

Return ONLY the message text — no quotes, no explanation, no subject line (unless the channel is email, in which case prefix with "Subject: <subject line>\n\n" before the body).`;

export async function generateCampaignCopy(input: GenerateCopyInput): Promise<GenerateCopyResult> {
  if (!env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY is not configured');
  }

  const client = getClient();

  const segmentDesc = SEGMENT_CONTEXT[input.segmentKey] ?? input.segmentKey;
  const channelDesc = CHANNEL_CONTEXT[input.channel] ?? input.channel;
  const typeDesc = CAMPAIGN_TYPE_CONTEXT[input.campaignType] ?? input.campaignType;
  const toneNote = input.tone === 'festive'
    ? 'Use a celebratory, warm tone with 1-2 relevant emojis.'
    : input.tone === 'formal'
    ? 'Use a polished, professional tone.'
    : 'Use a friendly, conversational tone.';

  const userPrompt = [
    `Write a ${channelDesc} for a ${typeDesc} campaign.`,
    `Target audience: ${segmentDesc}.`,
    toneNote,
    input.extraInstructions ? `Additional instructions: ${input.extraInstructions}` : null,
  ]
    .filter(Boolean)
    .join('\n');

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 400,
    system: [
      {
        type: 'text',
        text: SYSTEM_PROMPT,
        cache_control: { type: 'ephemeral' },
      },
    ],
    messages: [{ role: 'user', content: userPrompt }],
  });

  const copy = response.content
    .filter((b) => b.type === 'text')
    .map((b) => (b as Anthropic.TextBlock).text)
    .join('')
    .trim();

  const usage = response.usage as Anthropic.Usage & { cache_read_input_tokens?: number };

  return {
    copy,
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    cacheReadTokens: usage.cache_read_input_tokens ?? 0,
  };
}
