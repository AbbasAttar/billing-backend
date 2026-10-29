import type { RecurringKind, RecurringPart } from '../models/RecurringBill.model';
import type { VendorTxnType } from '../models/VendorAccount.model';

export const money = (n: number) => Math.round(n * 100) / 100;

export interface RecurringState {
  kind: RecurringKind;
  amount: number;
  totalInstallments?: number;
  paidInstallments: number;
  dueRemaining: number;
  cycle: number;
  status: 'active' | 'completed';
  /** split bills (e.g. rent: ₹12,500 cash + ₹12,500 online); amount is their sum */
  parts?: RecurringPart[];
}

const sumDue = (parts: RecurringPart[]) => money(parts.reduce((t, p) => t + p.due, 0));

type Result<T> = { ok: true; state: T; completedInstallment?: boolean } | { ok: false; error: string };

/**
 * Partial or full payment against the current cycle. Paying more than is due is refused.
 * Split bills need the part being paid (index into parts).
 */
export function applyRecurringPayment(s: RecurringState, pay: number, part?: number): Result<RecurringState> {
  if (s.status === 'completed')
    return { ok: false, error: s.kind === 'one_time' ? 'Already paid' : 'All installments are already paid' };
  if (!(pay > 0)) return { ok: false, error: 'amount must be greater than 0' };
  if (s.dueRemaining <= 0) return { ok: false, error: 'Nothing due this cycle. Reset to start the next one.' };

  let parts = s.parts;
  let dueRemaining: number;
  if (parts?.length) {
    const p = part !== undefined ? parts[part] : undefined;
    if (!p) return { ok: false, error: 'Choose which part of the bill you are paying' };
    if (p.due <= 0) return { ok: false, error: `${p.label} is already paid this cycle` };
    if (pay > p.due + 0.001) return { ok: false, error: `Only ₹${p.due} is due on ${p.label}` };
    parts = parts.map((x, i) => (i === part ? { ...x, due: money(Math.max(0, x.due - pay)) } : x));
    dueRemaining = sumDue(parts);
  } else {
    if (pay > s.dueRemaining + 0.001) return { ok: false, error: `Only ₹${s.dueRemaining} is due this cycle` };
    dueRemaining = money(Math.max(0, s.dueRemaining - pay));
  }
  if (dueRemaining > 0) return { ok: true, state: { ...s, parts, dueRemaining } };

  const paidInstallments = s.paidInstallments + 1;
  const done =
    s.kind === 'one_time' || (s.kind === 'installment' && !!s.totalInstallments && paidInstallments >= s.totalInstallments);
  return {
    ok: true,
    completedInstallment: true,
    state: { ...s, parts, dueRemaining: 0, paidInstallments, status: done ? 'completed' : 'active' },
  };
}

/** Undo a payment (its expense entry was deleted). Only payments of the current cycle can be undone. */
export function reverseRecurringPayment(
  s: RecurringState,
  pay: { amount: number; cycle?: number; completedInstallment?: boolean; part?: number },
): Result<RecurringState> {
  if (pay.cycle !== s.cycle)
    return { ok: false, error: 'This payment belongs to an earlier cycle of the bill and cannot be undone' };
  const next = { ...s, dueRemaining: money(Math.min(s.amount, s.dueRemaining + pay.amount)) };
  if (s.parts?.length && pay.part !== undefined && s.parts[pay.part]) {
    next.parts = s.parts.map((x, i) => (i === pay.part ? { ...x, due: money(Math.min(x.amount, x.due + pay.amount)) } : x));
    next.dueRemaining = sumDue(next.parts);
  }
  if (pay.completedInstallment) {
    next.paidInstallments = Math.max(0, s.paidInstallments - 1);
    next.status = 'active';
  }
  return { ok: true, state: next };
}

/**
 * Start the next cycle: the full amount (optionally a new one) is due again.
 * Split bills take new part amounts instead (same order as parts); omitted keeps them.
 */
export function resetRecurring(s: RecurringState, newAmount?: number, partAmounts?: number[]): Result<RecurringState> {
  if (s.kind === 'one_time') return { ok: false, error: 'One-time payments do not repeat' };
  if (s.status === 'completed') return { ok: false, error: 'All installments are already paid' };
  if (s.parts?.length) {
    if (partAmounts && (partAmounts.length !== s.parts.length || partAmounts.some((a) => !(a > 0))))
      return { ok: false, error: 'Every part needs an amount greater than 0' };
    const parts = s.parts.map((p, i) => {
      const amount = money(partAmounts ? partAmounts[i] : p.amount);
      return { ...p, amount, due: amount };
    });
    const amount = money(parts.reduce((t, p) => t + p.amount, 0));
    return { ok: true, state: { ...s, parts, amount, dueRemaining: amount, cycle: s.cycle + 1 } };
  }
  const amount = newAmount !== undefined ? newAmount : s.amount;
  if (!(amount > 0)) return { ok: false, error: 'amount must be greater than 0' };
  return { ok: true, state: { ...s, amount: money(amount), dueRemaining: money(amount), cycle: s.cycle + 1 } };
}

/** How a vendor transaction moves the amount owed. */
export function vendorBalanceDelta(type: VendorTxnType, amount: number): number {
  return type === 'add' ? amount : -amount;
}

export interface CategoryTxn {
  vendorId: string;
  type: VendorTxnType;
  amount: number;
  note?: string;
}

/** Dues brought in when a vendor was added are old debt, not this month's buying. */
const isOpeningBalance = (t: CategoryTxn) => t.type === 'add' && t.note === 'Opening balance';

/**
 * This month's progress on old dues. New buying within the caps is paid from the cap money, so the
 * target is the fixed repayment plus whatever cap money was not spent on new stock. Progress is the
 * net drop in what is owed (payments and discounts minus new bills).
 */
export function repaymentProgress(monthTxns: CategoryTxn[], repaymentBudget: number, caps: Record<string, number>) {
  const txns = monthTxns.filter((t) => !isOpeningBalance(t));
  const sum = (type: VendorTxnType) => money(txns.filter((t) => t.type === type).reduce((s, t) => s + t.amount, 0));
  const added = sum('add');
  const paid = sum('pay');
  const less = sum('less');
  const capTotal = money(Object.values(caps).reduce((t, c) => t + (c || 0), 0));
  const unusedCap = money(Math.max(0, capTotal - added));
  const target = money(repaymentBudget + unusedCap);
  const reduced = money(paid + less - added);
  return { added, paid, less, capTotal, unusedCap, repaymentBudget, target, reduced, left: money(Math.max(0, target - reduced)) };
}

/** Per vendor category: what is owed, bought (bills) and paid this month, against the purchase cap. */
export function vendorCategorySummary(
  vendors: { _id: string; category?: string; balance: number }[],
  monthTxns: CategoryTxn[],
  caps: Record<string, number>,
  categories: readonly string[],
) {
  const catOf = new Map(vendors.map((v) => [v._id, v.category ?? 'other']));
  return categories.map((category) => {
    const ids = new Set(vendors.filter((v) => (v.category ?? 'other') === category).map((v) => v._id));
    const txns = monthTxns.filter(
      (t) => !isOpeningBalance(t) && (ids.has(t.vendorId) || (!catOf.has(t.vendorId) && category === 'other')),
    );
    const sum = (type: VendorTxnType) => money(txns.filter((t) => t.type === type).reduce((s, t) => s + t.amount, 0));
    return {
      category,
      vendors: ids.size,
      owed: money(vendors.filter((v) => ids.has(v._id)).reduce((s, v) => s + Math.max(0, v.balance), 0)),
      purchased: sum('add'),
      paid: sum('pay'),
      cap: caps[category] ?? 0,
    };
  });
}

/** YYYY-MM month key. */
export const isMonthKey = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(v);

/** Payments per month per vendor, for comparing a hand-made schedule with what was actually paid. */
export function paidByMonth(txns: { vendorId: string; type: VendorTxnType; amount: number; date: Date | string }[]) {
  const out: Record<string, Record<string, number>> = {};
  for (const t of txns) {
    if (t.type !== 'pay') continue;
    const d = new Date(t.date);
    const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    out[k] ??= {};
    out[k][t.vendorId] = money((out[k][t.vendorId] ?? 0) + t.amount);
  }
  return out;
}

/** YYYY-MM-DD day key. */
export const isDayKey = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(v);

/** YYYY-MM key `n` months after `ym`. */
export function addMonthKey(ym: string, n: number): string {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** YYYY-MM key of a date (local time). */
export const monthKeyOf = (date: Date | string) => {
  const d = new Date(date);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

/** Pending cheques to vendors per month per vendor, the schedule's shape. */
export function chequesByMonth(cheques: { vendorId?: string; amount: number; chequeDate: Date | string }[]) {
  const out: Record<string, Record<string, number>> = {};
  for (const c of cheques) {
    if (!c.vendorId) continue;
    const k = monthKeyOf(c.chequeDate);
    out[k] ??= {};
    out[k][c.vendorId] = money((out[k][c.vendorId] ?? 0) + c.amount);
  }
  return out;
}

/** Scheduled payments go in steps of this much; dues below it are paid off in one go. */
export const PAYMENT_STEP = 5000;

/** A scheduled amount is valid in ₹5,000 steps, or as a single payment under ₹5,000. */
export const isPaymentStep = (amount: number) => amount < PAYMENT_STEP || amount % PAYMENT_STEP === 0;

/**
 * Month-by-month plan that clears old vendor dues at the fixed monthly repayment, from `startMonth`
 * until every vendor is cleared (at most `maxMonths`).
 *
 * Pending cheques are payments already promised: they come off the vendor's dues and take their
 * month's budget first. Then, each month:
 *  1. dues under ₹5,000 are paid off in one go (smallest first, while the budget lasts);
 *  2. the rest of the budget goes out in ₹5,000 steps, shared by what each vendor still owes
 *     (largest remainder first), never more steps than a vendor's dues hold.
 * A vendor's odd remainder under ₹5,000 is paid off in a later month by step 1. Budget left over
 * that does not make a whole step is not scheduled.
 *
 * Rows hold only the new (non-cheque) payments.
 */
export function buildRepaymentSchedule(
  vendors: { _id: string; balance: number }[],
  monthlyBudget: number,
  startMonth: string,
  cheques: Record<string, Record<string, number>> = {},
  maxMonths = 60,
): { month: string; vendorId: string; amount: number }[] {
  const left = new Map(vendors.filter((v) => v.balance > 0).map((v) => [v._id, money(v.balance)]));
  for (const byVendor of Object.values(cheques))
    for (const [id, amount] of Object.entries(byVendor))
      if (left.has(id)) left.set(id, money(Math.max(0, left.get(id)! - amount)));

  const rows: { month: string; vendorId: string; amount: number }[] = [];
  for (let i = 0; i < maxMonths; i++) {
    const owing = [...left].filter(([, a]) => a > 0.5).sort((a, b) => a[1] - b[1]);
    if (!owing.length) break;
    const month = addMonthKey(startMonth, i);
    const promised = Object.values(cheques[month] ?? {}).reduce((t, a) => t + a, 0);
    let budget = money(Math.max(0, monthlyBudget - promised));
    const pay = (id: string, amount: number) => {
      rows.push({ month, vendorId: id, amount });
      left.set(id, money(left.get(id)! - amount));
      budget = money(budget - amount);
    };

    // 1. Small dues in one go.
    for (const [id, owed] of owing) if (owed < PAYMENT_STEP && owed <= budget) pay(id, owed);

    // 2. Whole steps, shared by what is owed (largest-remainder rounding), capped per vendor.
    const big = owing.filter(([id]) => left.get(id)! >= PAYMENT_STEP).map(([id]) => ({ id, owed: left.get(id)! }));
    const cap = (o: { owed: number }) => Math.floor(o.owed / PAYMENT_STEP);
    let steps = Math.min(Math.floor(budget / PAYMENT_STEP), big.reduce((t, o) => t + cap(o), 0));
    const owedTotal = big.reduce((t, o) => t + o.owed, 0);
    const given = big.map((o) => {
      const exact = (steps * o.owed) / owedTotal;
      return { ...o, n: Math.min(cap(o), Math.floor(exact)), frac: exact - Math.floor(exact) };
    });
    steps -= given.reduce((t, g) => t + g.n, 0);
    // Leftover steps: biggest fraction first, then biggest dues, while a vendor has room.
    const order = [...given].sort((a, b) => b.frac - a.frac || b.owed - a.owed);
    while (steps > 0) {
      const g = order.find((x) => x.n < cap(x));
      if (!g) break;
      g.n++;
      steps--;
      order.push(order.splice(order.indexOf(g), 1)[0]);
    }
    for (const g of given) if (g.n > 0) pay(g.id, g.n * PAYMENT_STEP);
  }
  return rows;
}
