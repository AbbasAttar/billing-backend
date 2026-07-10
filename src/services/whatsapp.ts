import { env } from '../config/env';

export interface WhatsAppRecipient {
  phone: string;
  name: string;
}

export interface TemplateSendResult {
  phone: string;
  status: 'sent' | 'failed' | 'skipped';
  messageId?: string;
  error?: string;
  waLink?: string;
}

const cleanPhone = (raw: string): string => raw.replace(/\D/g, '');

const prependCountryCode = (phone: string): string => {
  const digits = cleanPhone(phone);
  if (digits.startsWith('91') && digits.length === 12) return digits;
  if (digits.length === 10) return `91${digits}`;
  return digits;
};

export const buildWaLink = (phone: string, message: string): string => {
  const intlPhone = prependCountryCode(phone);
  return `https://wa.me/${intlPhone}?text=${encodeURIComponent(message)}`;
};

export const sendWhatsAppTemplate = async (
  recipient: WhatsAppRecipient,
  templateName: string,
  languageCode: string,
  components: object[]
): Promise<TemplateSendResult> => {
  const token = env.WABA_TOKEN;
  const phoneNumberId = env.WABA_PHONE_NUMBER_ID;

  if (!token || !phoneNumberId) {
    return {
      phone: recipient.phone,
      status: 'skipped',
      error: 'WABA credentials not configured',
      waLink: buildWaLink(recipient.phone, `Hi ${recipient.name}`),
    };
  }

  const intlPhone = prependCountryCode(recipient.phone);

  try {
    const response = await fetch(
      `https://graph.facebook.com/v19.0/${phoneNumberId}/messages`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to: intlPhone,
          type: 'template',
          template: {
            name: templateName,
            language: { code: languageCode },
            components,
          },
        }),
      }
    );

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      return {
        phone: recipient.phone,
        status: 'failed',
        error: (err as any)?.error?.message ?? `HTTP ${response.status}`,
        waLink: buildWaLink(recipient.phone, `Hi ${recipient.name}`),
      };
    }

    const data = (await response.json()) as { messages?: { id: string }[] };
    return {
      phone: recipient.phone,
      status: 'sent',
      messageId: data.messages?.[0]?.id,
    };
  } catch (err) {
    return {
      phone: recipient.phone,
      status: 'failed',
      error: err instanceof Error ? err.message : 'Unknown error',
      waLink: buildWaLink(recipient.phone, `Hi ${recipient.name}`),
    };
  }
};

export const sendFreeFormMessage = async (
  recipient: WhatsAppRecipient,
  body: string
): Promise<TemplateSendResult> => {
  const token = env.WABA_TOKEN;
  const phoneNumberId = env.WABA_PHONE_NUMBER_ID;

  if (!token || !phoneNumberId) {
    return {
      phone: recipient.phone,
      status: 'skipped',
      error: 'WABA credentials not configured',
      waLink: buildWaLink(recipient.phone, body),
    };
  }

  const intlPhone = prependCountryCode(recipient.phone);

  try {
    const response = await fetch(
      `https://graph.facebook.com/v19.0/${phoneNumberId}/messages`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to: intlPhone,
          type: 'text',
          text: { body },
        }),
      }
    );

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      return {
        phone: recipient.phone,
        status: 'failed',
        error: (err as any)?.error?.message ?? `HTTP ${response.status}`,
        waLink: buildWaLink(recipient.phone, body),
      };
    }

    const data = (await response.json()) as { messages?: { id: string }[] };
    return {
      phone: recipient.phone,
      status: 'sent',
      messageId: data.messages?.[0]?.id,
    };
  } catch (err) {
    return {
      phone: recipient.phone,
      status: 'failed',
      error: err instanceof Error ? err.message : 'Unknown error',
      waLink: buildWaLink(recipient.phone, body),
    };
  }
};
