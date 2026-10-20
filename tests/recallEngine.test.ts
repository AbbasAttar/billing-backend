import { describe, it, expect, vi } from 'vitest';

vi.mock('../src/lib/firestoreDb', () => ({ getDb: () => ({}) }));

const { buildRecallTasks, expectedRefillDays } = await import('../src/services/recallEngine');

const today = new Date('2026-10-20T06:00:00Z');
const daysAgo = (n: number) => new Date(today.getTime() - n * 86_400_000);

let seq = 0;
const customer = (extra: Record<string, unknown> = {}) => ({ _id: `c${++seq}`, name: 'Asha', mobileNumber: '9876543210', ...extra });
const bill = (cust: any, days: number, items: any[]) => ({ _id: `i${++seq}`, customer: cust, billDate: daysAgo(days), total: 1000, items });
const frame = { type: 'frame', frame: { _id: 'f1', name: 'Aviator', companyName: 'RB' }, quantity: 1, price: 1500 };
const lens = { type: 'opticalLens', lensBrand: 'Essilor', lensName: 'Crizal', quantity: 1, price: 2000 };
const attar = (id = 'a1') => ({ type: 'fragrance', fragrance: { _id: id, name: `Amal ${id}`, type: 'attar' }, quantity: 1, price: 500 });

const all = (r: ReturnType<typeof buildRecallTasks>) => [...r.calls, ...r.messages];

describe('recall rules', () => {
  it('phones a frame buyer for a fit check 7–20 days after the bill', () => {
    const r = buildRecallTasks([bill(customer(), 10, [frame])], [], today);
    expect(r.calls).toHaveLength(1);
    expect(r.calls[0]).toMatchObject({ recallType: 'frame_fit_check', kind: 'service', channel: 'call' });
  });

  it('sends the frame upgrade on WhatsApp and the eye test as a call', () => {
    const r = buildRecallTasks([bill(customer(), 600, [frame]), bill(customer(), 360, [frame, lens])], [], today);
    expect(r.messages.map((t) => t.recallType)).toEqual(['frame_upgrade']);
    expect(r.calls.map((t) => t.recallType)).toEqual(['eye_test']);
  });

  it('a newer purchase cancels the older recall', () => {
    const c = customer();
    // Newest first, as the query returns them.
    const r = buildRecallTasks([bill(c, 50, [frame]), bill(c, 180, [frame])], [], today);
    expect(all(r)).toHaveLength(0);
  });

  it('one task per customer, service first, the rest listed as other reasons', () => {
    const c = customer();
    const r = buildRecallTasks([bill(c, 12, [frame]), bill(c, 50, [attar()])], [], today);
    expect(all(r)).toHaveLength(1);
    expect(r.calls[0].recallType).toBe('frame_fit_check');
    expect(r.calls[0].otherReasons.map((o) => o.recallType)).toEqual(['fragrance_refill']);
  });

  it('skips customers handled for this purchase, contacted recently, or not to be contacted', () => {
    const handled = customer({ recallContacts: { frame_fit_check: daysAgo(2) }, lastContactedAt: daysAgo(2), lastContactType: 'frame_fit_check', lastContactOutcome: 'visit_promised' });
    const noContact = customer({ contactPreference: 'no_contact' });
    const wrong = customer({ phoneInvalid: true });
    const r = buildRecallTasks([bill(handled, 10, [frame]), bill(noContact, 10, [frame]), bill(wrong, 10, [frame])], [], today);
    expect(all(r)).toHaveLength(0);
    expect(r.done.map((t) => t.customerId)).toEqual([handled._id]);
  });

  it('retries an unanswered call the next day, then moves it to WhatsApp after two misses', () => {
    const once = customer({ lastContactedAt: daysAgo(1), lastContactType: 'frame_fit_check', lastContactOutcome: 'no_answer', noAnswerCount: 1, nextAttemptAt: daysAgo(0.1) });
    const twice = customer({ lastContactedAt: daysAgo(1), lastContactType: 'frame_fit_check', lastContactOutcome: 'no_answer', noAnswerCount: 2, nextAttemptAt: daysAgo(0.1) });
    const later = customer({ lastContactedAt: daysAgo(0), lastContactType: 'frame_fit_check', lastContactOutcome: 'no_answer', noAnswerCount: 1, nextAttemptAt: daysAgo(-1) });
    const r = buildRecallTasks([bill(once, 10, [frame]), bill(twice, 10, [frame]), bill(later, 10, [frame])], [], today);
    expect(r.calls.map((t) => t.customerId)).toEqual([once._id]);
    expect(r.messages.map((t) => t.customerId)).toEqual([twice._id]);
  });

  it('honours a WhatsApp-only preference', () => {
    const r = buildRecallTasks([bill(customer({ contactPreference: 'whatsapp' }), 10, [frame])], [], today);
    expect(r.messages).toHaveLength(1);
  });

  it('fragrance refill uses the customer’s own buying gap, then pitches new scents', () => {
    const c = customer();
    const refill = buildRecallTasks([bill(c, 30, [attar()]), bill(c, 60, [attar()]), bill(c, 90, [attar()])], [], today);
    expect(refill.calls[0]).toMatchObject({ recallType: 'fragrance_refill' });
    expect(refill.calls[0].refillPicks?.[0]).toMatchObject({ fragranceId: 'a1', timesBought: 3 });

    const catalog = [{ _id: 'n1', name: 'Oud New', type: 'attar', stock: 5, createdAt: daysAgo(10) }];
    const lapsed = buildRecallTasks([bill(customer(), 150, [attar('a2')])], catalog, today);
    expect(lapsed.messages[0]).toMatchObject({ recallType: 'fragrance_new' });
    expect(lapsed.messages[0].newPicks?.[0]).toMatchObject({ fragranceId: 'n1' });
  });
});

describe('expectedRefillDays', () => {
  it('defaults by type and quantity, and learns from repeat purchases', () => {
    expect(expectedRefillDays([daysAgo(0)], 'attar', 1)).toBe(45);
    expect(expectedRefillDays([daysAgo(0)], 'perfume', 1)).toBe(75);
    expect(expectedRefillDays([daysAgo(0)], 'attar', 2)).toBe(68);
    expect(expectedRefillDays([daysAgo(100), daysAgo(70), daysAgo(40)], 'attar', 1)).toBe(30);
  });
});
