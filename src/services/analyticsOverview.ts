/**
 * Main analytics overview: one consistent set of figures for a period and the period before it.
 *
 * Rules, so the cards never contradict each other:
 * - Revenue = invoice totals (after discount). Category lines add up to revenue once the discount line
 *   is subtracted.
 * - Gross profit counts only lines with a cost price; each line's revenue is reduced by its bill's
 *   discount share. `coveragePct` says how much of revenue that covers.
 * - Net contribution = gross profit − packaging − payment fees, so it is never above gross profit.
 * - Expenses are split into stock purchases, running (operating) expenses and home expenses.
 * - Nothing is filled with a made-up default; unknown values are null.
 */

export interface OvPayment { date?: Date | string; amount?: number; method?: string }
export interface OvItem { fragranceGrade?: string; frame?: unknown; fragrance?: unknown; wholesaleItem?: unknown; opticalLens?: unknown; isCustomLens?: boolean; type?: string; lensType?: string; quantity?: number; price?: number; costPrice?: number }
export interface OvInvoice {
  billDate: Date | string; subtotal?: number; discount?: number; total?: number;
  payments?: OvPayment[]; items?: (OvItem | string | null)[];
  isNewCustomer?: boolean; visitNumber?: number; acquisitionSource?: string;
  packagingCost?: number; paymentProcessingFee?: number;
}
export interface OvExpense { date?: Date | string; amount?: number; category?: string; paymentMethod?: string }

// Old `expenses` categories plus the expense-log ones (vendor, home).
export const STOCK_EXPENSE_CATEGORIES = ['stock', 'vendor_order', 'vendor'];
export const HOME_EXPENSE_CATEGORIES = ['home_expense', 'home'];

const DAY = 86_400_000;
const idOf = (v: unknown) => (v && typeof v === 'object' && '_id' in (v as object) ? String((v as { _id: unknown })._id) : String(v ?? ''));
const r0 = (n: number) => Math.round(n);
const pct1 = (a: number, b: number) => (b > 0 ? Number(((a / b) * 100).toFixed(1)) : null);
const inRange = (d: Date, from: Date, to: Date) => d.getTime() >= from.getTime() && d.getTime() <= to.getTime();
const dayKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const asDate = (v: unknown) => (v instanceof Date ? v : new Date(String(v)));

export type PeriodKey = 'mtd' | 'last_month' | '30d' | '90d';

export interface Period {
  key: PeriodKey; label: string; from: Date; to: Date;
  compareLabel: string; compareFrom: Date; compareTo: Date;
  /** Calendar month the target applies to (mtd / last_month only). */
  targetMonth: string | null; daysInMonth: number; daysElapsed: number;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monthKey = (y: number, m: number) => `${y}-${String(m + 1).padStart(2, '0')}`;
const endOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);

export function resolvePeriod(key: string | undefined, now = new Date()): Period {
  const y = now.getFullYear();
  const m = now.getMonth();
  if (key === 'last_month') {
    const from = new Date(y, m - 1, 1);
    const to = endOfDay(new Date(y, m, 0));
    const days = to.getDate();
    const compareFrom = new Date(y, m - 2, 1);
    return {
      key: 'last_month', label: `${MONTHS[from.getMonth()]} ${from.getFullYear()}`, from, to,
      compareLabel: `${MONTHS[compareFrom.getMonth()]} ${compareFrom.getFullYear()}`, compareFrom, compareTo: endOfDay(new Date(y, m - 1, 0)),
      targetMonth: monthKey(from.getFullYear(), from.getMonth()), daysInMonth: days, daysElapsed: days,
    };
  }
  if (key === '30d' || key === '90d') {
    const n = key === '30d' ? 30 : 90;
    const to = endOfDay(now);
    const from = new Date(y, m, now.getDate() - n + 1);
    const compareTo = endOfDay(new Date(y, m, now.getDate() - n));
    const compareFrom = new Date(y, m, now.getDate() - 2 * n + 1);
    return { key, label: `Last ${n} days`, from, to, compareLabel: `previous ${n} days`, compareFrom, compareTo, targetMonth: null, daysInMonth: n, daysElapsed: n };
  }
  // Month to date, compared with the same days of last month.
  const day = now.getDate();
  const from = new Date(y, m, 1);
  const to = endOfDay(now);
  const lastMonthDays = new Date(y, m, 0).getDate();
  const compareFrom = new Date(y, m - 1, 1);
  const compareTo = endOfDay(new Date(y, m - 1, Math.min(day, lastMonthDays)));
  return {
    key: 'mtd', label: `${MONTHS[m]} ${y} (to date)`, from, to,
    compareLabel: `${MONTHS[(m + 11) % 12]} 1–${Math.min(day, lastMonthDays)}`, compareFrom, compareTo,
    targetMonth: monthKey(y, m), daysInMonth: new Date(y, m + 1, 0).getDate(), daysElapsed: day,
  };
}

type Group = 'Optics' | 'Fragrance' | 'Other';
const CATS = [
  { category: 'frame', name: 'Frames', group: 'Optics' as Group, color: '#2563EB' },
  { category: 'lens', name: 'Lenses', group: 'Optics' as Group, color: '#059669' },
  { category: 'fragrance', name: 'Retail', group: 'Fragrance' as Group, color: '#D97706' },
  { category: 'wholesale', name: 'Wholesale', group: 'Fragrance' as Group, color: '#A78BFA' },
  { category: 'other', name: 'Other items', group: 'Other' as Group, color: '#64748B' },
];
const kindOf = (it: OvItem): string => {
  if (it.wholesaleItem || it.type === 'wholesale') return 'wholesale';
  if (it.frame || it.type === 'frame') return 'frame';
  if (it.fragrance || it.type === 'fragrance') return 'fragrance';
  if (it.opticalLens || it.isCustomLens || it.type === 'opticalLens' || it.lensType) return 'lens';
  return 'other';
};

/** Unit cost for a line, or null when none is known. Default: the cost saved on the bill line. */
export type CostOf = (item: OvItem) => number | null;
const lineCost: CostOf = (it) => (typeof it.costPrice === 'number' && it.costPrice > 0 ? it.costPrice : null);

/**
 * Retail fragrance cost from the saved fragrance (its size variant first), as the owner keeps cost
 * there; other lines use the cost saved on the bill.
 */
export function savedFragranceCost(fragrances: { _id: unknown; costPrice?: number; variants?: { label?: string; costPrice?: number }[] }[]): CostOf {
  const byId = new Map(fragrances.map((f) => [String(f._id), f]));
  return (it) => {
    if (!(it.fragrance || it.type === 'fragrance')) return lineCost(it);
    const id = it.fragrance && typeof it.fragrance === 'object' && '_id' in (it.fragrance as object) ? String((it.fragrance as { _id: unknown })._id) : String(it.fragrance ?? '');
    const f = byId.get(id);
    if (!f) return lineCost(it);
    const v = it.fragranceGrade && f.variants?.length ? f.variants.find((x) => x.label === it.fragranceGrade) : undefined;
    const c = v?.costPrice || f.costPrice;
    return c && c > 0 ? c : null;
  };
}

/**
 * Sales figures for a set of bills. `catchAll`: ids of catch-all products (see catchAllProducts.ts);
 * their lines stay in revenue and their category but out of margin and the missing-cost count.
 */
export function salesFigures(invoices: OvInvoice[], costOf: CostOf = lineCost, catchAll: Set<string> = new Set(), wholesaleMix: Set<string> = new Set()) {
  // The "Wholesale" fragrance is a mixed wholesale order, so it belongs to Wholesale, not Retail.
  const categoryOf = (it: OvItem) => (wholesaleMix.size > 0 && wholesaleMix.has(idOf(it.fragrance)) ? 'wholesale' : kindOf(it));
  let mixedRevenue = 0, mixedLines = 0;
  let revenue = 0, billed = 0, discount = 0, cogs = 0, costedNet = 0, uncostedLines = 0, packaging = 0, fees = 0;
  let newRev = 0, newCount = 0, repeatRev = 0, repeatCount = 0;
  const cat = new Map<string, { billed: number; costedNet: number; cost: number }>();
  const sources = new Map<string, { count: number; revenue: number }>();

  for (const inv of invoices) {
    const total = inv.total ?? 0;
    const lines = (inv.items ?? []).filter((x): x is OvItem => !!x && typeof x === 'object');
    const lineSum = lines.reduce((s, it) => s + (it.quantity || 1) * (it.price || 0), 0);
    const subtotal = inv.subtotal ?? lineSum;
    const disc = inv.discount ?? Math.max(0, subtotal - total);
    const keep = subtotal > 0 ? Math.max(0, 1 - disc / subtotal) : 1; // share of each line kept after discount
    revenue += total;
    billed += subtotal;
    discount += disc;
    packaging += typeof inv.packagingCost === 'number' ? inv.packagingCost : 0;
    fees += typeof inv.paymentProcessingFee === 'number' ? inv.paymentProcessingFee : 0;

    for (const it of lines) {
      const qty = it.quantity || 1;
      const lineRev = qty * (it.price || 0);
      const c = cat.get(categoryOf(it)) ?? { billed: 0, costedNet: 0, cost: 0 };
      c.billed += lineRev;
      const isCatchAll = catchAll.size > 0 && (catchAll.has(idOf(it.frame)) || catchAll.has(idOf(it.fragrance)));
      const unitCost = isCatchAll ? null : costOf(it);
      if (isCatchAll) {
        mixedRevenue += lineRev;
        mixedLines += 1;
      } else if (unitCost !== null) {
        const net = lineRev * keep;
        const cost = qty * unitCost;
        c.costedNet += net;
        c.cost += cost;
        costedNet += net;
        cogs += cost;
      } else if (lineRev > 0) {
        uncostedLines += 1;
      }
      cat.set(categoryOf(it), c);
    }

    // A first bill tapped as "Repeat client" is an old customer billed here for the first time
    // (bills start in July 2025), so it counts as repeat, not new.
    const isNew = (inv.isNewCustomer ?? inv.visitNumber === 1) && inv.acquisitionSource !== 'repeat';
    if (isNew) { newRev += total; newCount += 1; } else { repeatRev += total; repeatCount += 1; }
    const src = !isNew ? 'repeat' : inv.acquisitionSource || 'not_recorded';
    const s = sources.get(src) ?? { count: 0, revenue: 0 };
    s.count += 1;
    s.revenue += total;
    sources.set(src, s);
  }

  const grossProfit = costedNet - cogs;
  const categories = CATS.map((c) => {
    const v = cat.get(c.category) ?? { billed: 0, costedNet: 0, cost: 0 };
    return {
      group: c.group, name: c.name, category: c.category, color: c.color,
      revenue: r0(v.billed),
      sharePct: pct1(v.billed, billed) ?? 0,
      marginPct: v.costedNet > 0 ? Number((((v.costedNet - v.cost) / v.costedNet) * 100).toFixed(1)) : null,
    };
  }).filter((c) => c.category !== 'other' || c.revenue > 0);

  return {
    revenue: r0(revenue), billed: r0(billed), discount: r0(discount), invoices: invoices.length,
    aov: invoices.length ? r0(revenue / invoices.length) : 0,
    grossProfit: costedNet > 0 ? r0(grossProfit) : null,
    marginPct: costedNet > 0 ? Number(((grossProfit / costedNet) * 100).toFixed(1)) : null,
    coveragePct: pct1(costedNet, revenue),
    uncostedLines,
    mixedSales: { revenue: r0(mixedRevenue), lines: mixedLines },
    netContribution: costedNet > 0 ? r0(grossProfit - packaging - fees) : null,
    packaging: r0(packaging), fees: r0(fees),
    categories,
    customers: {
      newRevenue: r0(newRev), newCount, repeatRevenue: r0(repeatRev), repeatCount,
      sources: [...sources].map(([source, v]) => ({ source, count: v.count, revenue: r0(v.revenue) })).sort((a, b) => b.revenue - a.revenue),
    },
  };
}

/** Money received in the window (by payment date), split cash / UPI, plus per-day totals. */
export function collections(invoices: OvInvoice[], from: Date, to: Date) {
  let cash = 0, upi = 0;
  const byDay = new Map<string, { cash: number; upi: number }>();
  for (const inv of invoices) {
    for (const p of inv.payments ?? []) {
      const d = asDate(p.date ?? inv.billDate);
      if (Number.isNaN(d.getTime()) || !inRange(d, from, to)) continue;
      const amt = p.amount || 0;
      const isCash = (p.method || 'cash').toLowerCase().includes('cash');
      if (isCash) cash += amt; else upi += amt;
      const k = dayKey(d);
      const b = byDay.get(k) ?? { cash: 0, upi: 0 };
      if (isCash) b.cash += amt; else b.upi += amt;
      byDay.set(k, b);
    }
  }
  return { total: r0(cash + upi), cash: r0(cash), upi: r0(upi), byDay };
}

export function expenseFigures(expenses: OvExpense[], from: Date, to: Date) {
  let stock = 0, operating = 0, home = 0, cashOut = 0;
  const byCategory = new Map<string, number>();
  const byDay = new Map<string, { stock: number; operating: number }>();
  for (const e of expenses) {
    const d = e.date ? asDate(e.date) : null;
    if (!d || Number.isNaN(d.getTime()) || !inRange(d, from, to)) continue;
    const amt = e.amount || 0;
    const c = e.category || 'miscellaneous';
    const k = dayKey(d);
    const b = byDay.get(k) ?? { stock: 0, operating: 0 };
    if (STOCK_EXPENSE_CATEGORIES.includes(c)) { stock += amt; b.stock += amt; }
    else if (HOME_EXPENSE_CATEGORIES.includes(c)) home += amt;
    else { operating += amt; b.operating += amt; byCategory.set(c, (byCategory.get(c) ?? 0) + amt); }
    byDay.set(k, b);
    if ((e.paymentMethod || 'cash').toLowerCase() === 'cash' && !HOME_EXPENSE_CATEGORIES.includes(c)) cashOut += amt;
  }
  return {
    stockPurchases: r0(stock), operating: r0(operating), home: r0(home), cashOut: r0(cashOut),
    operatingByCategory: [...byCategory].map(([category, amount]) => ({ category, amount: r0(amount) })).sort((a, b) => b.amount - a.amount),
    byDay,
  };
}

/** Target progress: share achieved so far, run-rate projection and what is needed per remaining day. */
export function targetProgress(target: number | null | undefined, revenue: number, period: Period) {
  if (!target || target <= 0 || !period.targetMonth) return null;
  const remainingDays = Math.max(0, period.daysInMonth - period.daysElapsed);
  const projected = period.daysElapsed > 0 ? r0((revenue / period.daysElapsed) * period.daysInMonth) : revenue;
  const remaining = Math.max(0, target - revenue);
  return {
    target: r0(target),
    achieved: r0(revenue),
    achievedPct: pct1(revenue, target) ?? 0,
    projected,
    projectedPct: pct1(projected, target) ?? 0,
    remaining: r0(remaining),
    remainingDays,
    requiredPerDay: remainingDays > 0 ? r0(remaining / remainingDays) : remaining > 0 ? r0(remaining) : 0,
    runRatePerDay: period.daysElapsed > 0 ? r0(revenue / period.daysElapsed) : 0,
  };
}

/** Day-by-day revenue for the period, side by side with the same day of the comparison period. */
export function dailySeries(current: OvInvoice[], previous: OvInvoice[], period: Period) {
  const days = Math.max(1, Math.round((endOfDay(period.to).getTime() - period.from.getTime()) / DAY));
  const cur = new Array(days).fill(0);
  const prev = new Array(days).fill(0);
  const idx = (d: Date, start: Date) => Math.floor((new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() - new Date(start.getFullYear(), start.getMonth(), start.getDate()).getTime()) / DAY);
  for (const inv of current) {
    const i = idx(asDate(inv.billDate), period.from);
    if (i >= 0 && i < days) cur[i] += inv.total ?? 0;
  }
  for (const inv of previous) {
    const i = idx(asDate(inv.billDate), period.compareFrom);
    if (i >= 0 && i < days) prev[i] += inv.total ?? 0;
  }
  return cur.map((v, i) => {
    const d = new Date(period.from.getFullYear(), period.from.getMonth(), period.from.getDate() + i);
    return { date: dayKey(d), label: `${d.getDate()} ${MONTHS[d.getMonth()]}`, revenue: r0(v), previous: r0(prev[i]) };
  });
}

/** Per-day money in (cash + UPI) and out (stock purchases, running expenses) for the cash chart. */
export function cashSeries(col: ReturnType<typeof collections>, exp: ReturnType<typeof expenseFigures>, period: Period) {
  const days = Math.max(1, Math.round((endOfDay(period.to).getTime() - period.from.getTime()) / DAY));
  return Array.from({ length: days }, (_, i) => {
    const d = new Date(period.from.getFullYear(), period.from.getMonth(), period.from.getDate() + i);
    const k = dayKey(d);
    const c = col.byDay.get(k) ?? { cash: 0, upi: 0 };
    const e = exp.byDay.get(k) ?? { stock: 0, operating: 0 };
    return { date: k, label: `${d.getDate()} ${MONTHS[d.getMonth()]}`, cash: r0(c.cash), upi: r0(c.upi), stock: r0(e.stock), operating: r0(e.operating) };
  });
}
