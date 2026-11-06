/**
 * Audit trail: who changed what in the admin/POS app. Pure helpers (what to log, how to describe
 * it, what to flag); the middleware in middleware/auditTrail.ts collects and writes the entries.
 */

/** Drives the row icon/colour on the audit page. */
export type AuditKind = 'create' | 'update' | 'delete' | 'payment' | 'failed';

export type AuditFlag = 'high_discount' | 'free_bill' | 'deleted' | 'payment_edited' | 'writeoff' | 'failed';

/** Bill fields read before an invoice change, so the log can say "₹0 → ₹200". */
export interface InvoiceBefore {
  invoiceNumber?: string;
  discount?: number;
  subtotal?: number;
  total?: number;
  customer?: string;
  billDate?: string;
  payments?: { amount: number; method?: string; writeoff?: number }[];
  items?: number;
}

export interface AuditInput {
  method: string;
  /** Path inside the admin API, e.g. /invoices/abc/payment. */
  path: string;
  status: number;
  body?: unknown;
  /** Small picks from the JSON response (_id, invoiceNumber, name, total, discount, subtotal). */
  response?: Record<string, unknown> | null;
  before?: InvoiceBefore | null;
  /** Stored record read before an update / delete (customers, frames, bill lines…), for before → after. */
  beforeDoc?: Record<string, unknown> | null;
}

/** Discount share of the bill at or above which an entry is flagged (target ceiling is 5%). */
export const HIGH_DISCOUNT_PCT = 10;

const WRITE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** Writes that change nothing worth auditing (lookups sent as POST, delivery receipts, AI chat, devices). */
const SKIP: RegExp[] = [
  /^\/ai(\/|$)/,
  /^\/notifications(\/|$)/,
  /^\/lens-pricing\/(match|resolve)$/,
  /^\/lens-catalog\/(compare|quote)$/,
  /^\/invoices\/[^/]+\/(whatsapp-sent|push-to-excel)$/,
  /^\/dashboard\/recalls\//,
];

export function shouldAudit(method: string, path: string): boolean {
  const p = path.replace(/\/+$/, '') || '/';
  return WRITE.has(method.toUpperCase()) && !SKIP.some((r) => r.test(p));
}

/** /invoices/:id… (not /invoices/renumber or /invoices/demand) → the bill id, for reading its state first. */
export function invoiceIdOf(path: string): string | null {
  const m = /^\/invoices\/([^/]+)(\/.*)?$/.exec(path.replace(/\/+$/, ''));
  if (!m || ['renumber', 'demand'].includes(m[1])) return null;
  return m[1];
}

const SECRET_KEY = /pass|token|secret|otp|api[-_]?key|authorization|cookie/i;

/** Copy of a request body safe to store: secrets dropped, long strings (images) cut, size capped. */
export function redactBody(body: unknown, maxChars = 4000): unknown {
  const walk = (v: unknown, depth: number): unknown => {
    if (v === null || v === undefined) return v;
    if (typeof v === 'string') return v.length > 300 ? `[${v.length} chars]` : v;
    if (typeof v !== 'object') return v;
    if (depth > 4) return '[…]';
    if (Array.isArray(v)) {
      const out = v.slice(0, 30).map((x) => walk(x, depth + 1));
      if (v.length > 30) out.push(`[+${v.length - 30} more]`);
      return out;
    }
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      out[k] = SECRET_KEY.test(k) ? '[hidden]' : walk(x, depth + 1);
    }
    return out;
  };
  const clean = walk(body, 0);
  if (clean === undefined) return undefined;
  const json = JSON.stringify(clean);
  if (json === undefined || json === '{}') return undefined;
  return json.length > maxChars ? { truncated: json.slice(0, maxChars) } : clean;
}

const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const rs = (n: number | undefined) => `₹${Math.round(n ?? 0).toLocaleString('en-IN')}`;
const pctOf = (discount?: number, subtotal?: number) => (discount && subtotal && subtotal > 0 ? (discount / subtotal) * 100 : 0);
const sumPaid = (p?: InvoiceBefore['payments']) => (p ?? []).reduce((s, x) => s + (x.amount || 0), 0);
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const str = (v: unknown) => (v === undefined || v === null ? '' : String(v).trim());

/** Record name for each API area (badge on the card, noun in the action). */
const AREA_LABEL: Record<string, string> = {
  customers: 'customer',
  frames: 'frame',
  fragrances: 'fragrance',
  'optical-lenses': 'lens',
  'lens-stock': 'lens stock',
  'contact-lenses': 'contact lens',
  prescriptions: 'prescription',
  purchases: 'purchase',
  expenses: 'expense',
  cashflow: 'cash entry',
  'vendor-bills': 'vendor bill',
  'wholesale-items': 'wholesale item',
  'data-quality': 'data cleanup',
  settings: 'setting',
  fitting: 'fitting job',
  requirements: 'requirement',
  'customer-requirements': 'requirement',
};

export type AuditCategory = 'payments' | 'bills' | 'inventory' | 'customers' | 'finance' | 'settings' | 'other';

const CATEGORY_AREAS: [AuditCategory, string[]][] = [
  ['payments', ['payments']],
  ['bills', ['invoices', 'invoice-items', 'fitting', 'wholesaler-queue', 'orders']],
  ['inventory', ['frames', 'fragrances', 'optical-lenses', 'lens-stock', 'contact-lenses', 'wholesale-items', 'purchases', 'frame-stock', 'inventory', 'lens-reorder']],
  ['customers', ['customers', 'prescriptions', 'requirements', 'customer-requirements', 'lost-sales', 'data-quality', 'bill-feedback']],
  ['finance', ['expenses', 'cashflow', 'vendor-bills', 'ledger', 'obligations', 'obligation-payments', 'debts', 'debt-payments', 'debt-config', 'saving-goals', 'recurring-expenses', 'personal-expenses', 'commitments', 'cheques']],
  ['settings', ['settings', 'lens-pricing', 'coatings', 'lens-options', 'lens-catalog', 'frame-companies', 'frame-colors', 'monthly-targets', 'automation', 'campaigns', 'marketing', 'blog']],
];

/** Filter group for an entry (payments on a bill count as payments, not bills). */
export function categoryOf(path: string): AuditCategory {
  const parts = path.split('/').filter(Boolean);
  if (parts[0] === 'invoices' && parts[2] === 'payment') return 'payments';
  return CATEGORY_AREAS.find(([, areas]) => areas.includes(parts[0] ?? ''))?.[0] ?? 'other';
}

export const areaOf = (path: string) => path.split('/')[1] ?? '';

const FIELD_LABEL: Record<string, string> = {
  sellPrice: 'Sell price', costPrice: 'Cost price', storePrice: 'Store price', mrp: 'MRP', stock: 'Stock', quantity: 'Quantity',
  price: 'Price', name: 'Name', houseName: 'House name', companyName: 'Brand', frameCode: 'Code', mobileNumber: 'Mobile',
  address: 'Address', email: 'Email', discount: 'Discount', billDate: 'Bill date', notes: 'Notes', category: 'Category',
  type: 'Type', isArchived: 'Archived', amount: 'Amount', method: 'Method', writeoff: 'Write-off', customer: 'Customer',
  payments: 'Payments paid', acquisitionSource: 'Source', fragranceGrade: 'Grade', status: 'Status', date: 'Date',
};
const MONEY_FIELD = /price|cost|amount|total|discount|mrp|writeoff|balance|payments/i;
const IGNORE_FIELD = new Set(['_id', 'id', '__v', 'createdAt', 'updatedAt', 'searchTokens', 'expireAt']);
export const fieldLabel = (k: string) => FIELD_LABEL[k] ?? cap(k.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]/g, ' ').toLowerCase());

export interface AuditChange { field: string; label: string; from: unknown; to: unknown; money?: boolean }
export interface AuditFact { label: string; value: string }
/** Money figures shown side by side on the card (total, discount, paid, due, write-off). */
export interface AuditFigure { label: string; value: string; tone?: 'warn' | 'bad' | 'good' }
export interface AuditRef { type: 'invoice' | 'customer' | 'record'; label: string; value: string; id?: string }

/** Short, storable form of a value (lists and objects summarised). */
function shortValue(v: unknown): unknown {
  if (v === undefined) return null;
  if (v === null || typeof v === 'number' || typeof v === 'boolean') return v;
  if (typeof v === 'string') return v.length > 120 ? `${v.slice(0, 117)}…` : v;
  if (Array.isArray(v)) return `${v.length} item${v.length === 1 ? '' : 's'}`;
  if (v instanceof Date) return v.toISOString();
  const json = JSON.stringify(v);
  return json.length > 120 ? 'changed' : json;
}

const blank = (v: unknown) => v === undefined || v === null || v === '';
const same = (a: unknown, b: unknown) => {
  if (a === b) return true;
  if (blank(a) && blank(b)) return true;
  if (blank(a) || blank(b)) return false;
  if (typeof a === 'number' || typeof b === 'number') return Number(a) === Number(b);
  if (a instanceof Date || b instanceof Date) return new Date(a as string).getTime() === new Date(b as string).getTime();
  if (typeof a === 'object' || typeof b === 'object') return JSON.stringify(a) === JSON.stringify(b);
  return String(a) === String(b);
};

const isPlain = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date);
const singular = (label: string) => (label.endsWith('s') && label.length > 3 ? label.slice(0, -1) : label);
/** Name for one element of a list: its own label / name / size, else its position. */
const itemName = (v: unknown, i: number) => {
  const own = isPlain(v) ? v.label ?? v.name ?? v.size ?? v.power : undefined;
  return own !== undefined && own !== null && String(own).trim() ? String(own).trim() : String(i + 1);
};
const listText = (v: unknown[]) => {
  const text = v.map((x) => (isPlain(x) ? itemName(x, 0) : String(x))).join(', ');
  return text.length <= 120 ? text || '(none)' : `${v.length} items`;
};

/**
 * Fields the request changes: each body value that differs from the stored record. Nested objects
 * and lists of objects (variants, web fields) are compared inside, so the log says
 * "Variant 30ml · Sell price ₹400 → ₹450" instead of "3 items → 3 items".
 */
export function diffFields(before: Record<string, unknown> | null | undefined, body: unknown, max = 25): AuditChange[] {
  if (!before || !isPlain(body)) return [];
  const out: AuditChange[] = [];
  const push = (field: string, label: string, leaf: string, from: unknown, to: unknown) => {
    if (out.length < max) out.push({ field, label, from: shortValue(from), to: shortValue(to), ...(MONEY_FIELD.test(leaf) ? { money: true } : {}) });
  };
  const walk = (field: string, label: string, leaf: string, from: unknown, to: unknown, depth: number) => {
    if (to === undefined || out.length >= max || same(from, to)) return;
    if (depth < 3 && isPlain(to) && (isPlain(from) || from === undefined || from === null)) {
      const f = isPlain(from) ? from : {};
      for (const [k, v] of Object.entries(to)) {
        if (IGNORE_FIELD.has(k) || SECRET_KEY.test(k)) continue;
        walk(`${field}.${k}`, depth === 0 && field === '' ? fieldLabel(k) : `${label} · ${fieldLabel(k)}`, k, f[k], v, depth + 1);
      }
      return;
    }
    if (Array.isArray(to)) {
      const f = Array.isArray(from) ? from : [];
      if (depth < 3 && to.length === f.length && to.every(isPlain) && f.every(isPlain)) {
        to.forEach((item, i) => walk(`${field}.${i}`, `${singular(label)} ${itemName(item, i)}`, leaf, f[i], item, depth + 1));
        return;
      }
      if (to.every((x) => !isPlain(x)) && f.every((x) => !isPlain(x))) return push(field, label, leaf, listText(f), listText(to));
      return push(field, label, leaf, `${f.length} item${f.length === 1 ? '' : 's'}`, `${to.length} item${to.length === 1 ? '' : 's'}`);
    }
    push(field, label, leaf, from, to);
  };
  for (const [k, to] of Object.entries(body)) {
    if (IGNORE_FIELD.has(k) || SECRET_KEY.test(k)) continue;
    walk(k, fieldLabel(k), k, before[k], to, 1);
  }
  return out;
}

/** Facts worth showing for an added / deleted record. */
const FACT_KEYS = ['frameCode', 'companyName', 'category', 'type', 'mobileNumber', 'address', 'sellPrice', 'costPrice', 'stock', 'quantity', 'price', 'amount', 'date'];
function recordFacts(src: Record<string, unknown> | null | undefined): AuditFact[] {
  if (!src) return [];
  return FACT_KEYS.filter((k) => !blank(src[k]) && typeof src[k] !== 'object').map((k) => ({
    label: fieldLabel(k),
    value: MONEY_FIELD.test(k) && typeof src[k] === 'number' ? rs(src[k] as number) : String(src[k]),
  }));
}

/** /area/:id/<sub> routes with their own verb, and the field they flip. */
const SUB_ACTION: Record<string, { verb: string; change?: AuditChange }> = {
  archive: { verb: 'Archived', change: { field: 'isArchived', label: 'Archived', from: false, to: true } },
  unarchive: { verb: 'Restored', change: { field: 'isArchived', label: 'Archived', from: true, to: false } },
  restore: { verb: 'Restored', change: { field: 'isArchived', label: 'Archived', from: true, to: false } },
  tags: { verb: 'Tagged' },
  publish: { verb: 'Published' },
  refill: { verb: 'Refilled' },
  merge: { verb: 'Merged' },
  unpublish: { verb: 'Unpublished' },
};

const fmtChange = (v: unknown, money?: boolean) => (blank(v) ? '—' : money && typeof v === 'number' ? rs(v) : String(v));

export interface AuditDescription {
  /** One sentence (search, old clients). */
  summary: string;
  flags: AuditFlag[];
  kind: AuditKind;
  category: AuditCategory;
  /** Verb first: "Added payment", "Edited bill", "Updated frame". */
  action: string;
  /** Badge: "Payment", "Bill", "Frame"… */
  badge: string;
  /** The value to read first: an amount, a bill number, a record name. */
  primary?: { label: string; value: string };
  /** One line under the primary value ("Online payment", "Walk-in · total ₹850"). */
  secondary?: string;
  /** The record it touched (bill / customer). */
  reference?: AuditRef;
  /** Extra values worth seeing collapsed (write-off, discount). */
  chips: string[];
  /** Everything entered, for the expanded view. */
  facts: AuditFact[];
  /** Key amounts, readable at a glance. */
  figures: AuditFigure[];
  /** Before → after for edits. */
  changes: AuditChange[];
  /** Kept for search and older UI. */
  subject: string;
  amount?: number;
  details: string[];
}

export function describe({ method, path, status, body, response, before, beforeDoc }: AuditInput): AuditDescription {
  const m = method.toUpperCase();
  const p = path.replace(/\/+$/, '') || '/';
  const parts = p.split('/').filter(Boolean);
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, any>;
  const r = response ?? {};
  const flags: AuditFlag[] = [];
  const failed = status >= 400;
  if (failed) flags.push('failed');
  const billNo = str(r.invoiceNumber ?? before?.invoiceNumber);
  const invoiceId = invoiceIdOf(p) ?? (parts[0] === 'invoices' && parts.length === 1 ? str(r._id ?? r.id) : '');
  const billRef: AuditRef | undefined = billNo ? { type: 'invoice', label: 'Invoice', value: billNo, ...(invoiceId ? { id: invoiceId } : {}) } : undefined;

  const flagDiscount = (discount?: number, subtotal?: number, total?: number) => {
    if (subtotal && subtotal > 0 && total === 0 && (discount ?? 0) > 0) flags.push('free_bill');
    else if (pctOf(discount, subtotal) >= HIGH_DISCOUNT_PCT) flags.push('high_discount');
  };

  let kind: AuditKind = 'update';
  let action = '';
  let badge = '';
  let primary: AuditDescription['primary'];
  let secondary: string | undefined;
  let reference: AuditRef | undefined;
  let amount: number | undefined;
  const chips: string[] = [];
  const facts: AuditFact[] = [];
  const figures: AuditFigure[] = [];
  const pct = (part?: number, whole?: number) => (part && whole ? ` · ${pctOf(part, whole).toFixed(1)}%` : '');
  let changes: AuditChange[] = [];

  if (parts[0] === 'invoices') {
    const sub = parts[2];
    if (m === 'POST' && parts.length === 1) {
      const discount = num(r.discount) ?? num(b.discount);
      const lineSum = Array.isArray(b.items) ? b.items.reduce((t: number, x: any) => t + (num(x?.price) ?? 0) * (num(x?.quantity) ?? 1), 0) : 0;
      const subtotal = num(r.subtotal) ?? (lineSum > 0 ? lineSum : undefined);
      // The bill form sends `initialPayments`; older clients sent `payments`.
      const paidList: any[] | undefined = Array.isArray(b.initialPayments) ? b.initialPayments : Array.isArray(b.payments) ? b.payments : undefined;
      const customerName = str(r.customerName ?? b.customerName);
      kind = 'create';
      action = 'Created bill';
      badge = 'Bill';
      amount = num(r.total);
      primary = { label: 'Bill', value: billNo || 'New bill' };
      secondary = [customerName, amount !== undefined ? `total ${rs(amount)}` : ''].filter(Boolean).join(' · ') || undefined;
      reference = billRef;
      const paidNow = paidList ? paidList.reduce((t: number, x: any) => t + (num(x?.amount) ?? 0), 0) : undefined;
      const methods = [...new Set((paidList ?? []).map((x: any) => str(x?.method)).filter(Boolean))].join(' + ');
      if (amount !== undefined) figures.push({ label: 'Total', value: rs(amount) });
      if (discount && discount > 0) figures.push({ label: 'Discount', value: `${rs(discount)}${pct(discount, subtotal)}`, tone: 'warn' });
      if (paidNow !== undefined) figures.push({ label: methods ? `Paid · ${methods}` : 'Paid', value: rs(paidNow), tone: paidNow > 0 ? 'good' : undefined });
      if (amount !== undefined && paidNow !== undefined && amount - paidNow > 0) figures.push({ label: 'Due', value: rs(amount - paidNow), tone: 'bad' });
      if (customerName) facts.push({ label: 'Customer', value: customerName });
      if (subtotal !== undefined) facts.push({ label: 'Subtotal', value: rs(subtotal) });
      if (discount) facts.push({ label: 'Discount', value: rs(discount) });
      if (amount !== undefined) facts.push({ label: 'Total', value: rs(amount) });
      if (Array.isArray(b.items)) facts.push({ label: 'Lines', value: String(b.items.length) });
      if (paidList?.length) {
        facts.push({ label: 'Paid at billing', value: paidList.map((x: any) => `${rs(num(x?.amount))}${x?.method ? ` ${x.method}` : ''}`).join(', ') });
      }
      if (!failed) flagDiscount(discount, subtotal, amount);
    } else if (m === 'DELETE' && parts.length === 2) {
      kind = 'delete';
      action = 'Deleted bill';
      badge = 'Bill';
      amount = before?.total;
      primary = { label: 'Bill', value: billNo || 'Bill' };
      if (before?.total !== undefined) secondary = `Total ${rs(before.total)} · paid ${rs(sumPaid(before.payments))}`;
      if (before?.total !== undefined) figures.push({ label: 'Total', value: rs(before.total) });
      if (before?.discount) figures.push({ label: 'Discount', value: `${rs(before.discount)}${pct(before.discount, before.subtotal)}`, tone: 'warn' });
      if (before) figures.push({ label: 'Paid', value: rs(sumPaid(before.payments)) });
      if (before?.subtotal !== undefined) facts.push({ label: 'Subtotal', value: rs(before.subtotal) });
      if (before?.discount) facts.push({ label: 'Discount', value: rs(before.discount) });
      if (before?.total !== undefined) facts.push({ label: 'Total', value: rs(before.total) });
      if (before?.payments?.length) facts.push({ label: 'Paid', value: rs(sumPaid(before.payments)) });
      if (before?.items !== undefined) facts.push({ label: 'Lines', value: String(before.items) });
      flags.push('deleted');
    } else if (m === 'PUT' && parts.length === 2) {
      badge = 'Bill';
      if (b.discount !== undefined && num(b.discount) !== (before?.discount ?? 0)) {
        changes.push({ field: 'discount', label: 'Discount', from: before?.discount ?? 0, to: num(b.discount) ?? null, money: true });
        if (!failed && (num(b.discount) ?? 0) > (before?.discount ?? 0)) {
          flagDiscount(num(b.discount), before?.subtotal, Math.max(0, (before?.subtotal ?? 0) - (num(b.discount) ?? 0)));
        }
      }
      if (b.billDate !== undefined && before?.billDate && str(b.billDate).slice(0, 10) !== before.billDate.slice(0, 10)) {
        changes.push({ field: 'billDate', label: 'Bill date', from: before.billDate.slice(0, 10), to: str(b.billDate).slice(0, 10) });
      }
      if (b.customer !== undefined) {
        const to = typeof b.customer === 'object' ? b.customer?._id ?? b.customer?.id : b.customer;
        if (to && String(to) !== before?.customer) changes.push({ field: 'customer', label: 'Customer', from: before?.customer ?? null, to: String(to) });
      }
      if (Array.isArray(b.payments)) {
        const after = b.payments.reduce((s: number, x: any) => s + (num(x?.amount) ?? 0), 0);
        if (after !== sumPaid(before?.payments) || b.payments.length !== (before?.payments?.length ?? 0)) {
          changes.push({ field: 'payments', label: 'Payments paid', from: sumPaid(before?.payments), to: after, money: true });
          if (after < sumPaid(before?.payments)) flags.push('payment_edited');
        }
        if (b.payments.some((x: any) => (num(x?.writeoff) ?? 0) > 0)) flags.push('writeoff');
      }
      if (b.acquisitionSource !== undefined) changes.push({ field: 'acquisitionSource', label: 'Source', from: null, to: str(b.acquisitionSource) });
      if (changes.length === 1 && changes[0].field === 'discount') {
        // Only the discount changed: lead with it.
        action = 'Changed discount';
        amount = num(b.discount);
        primary = { label: 'Discount', value: rs(amount) };
        secondary = `was ${rs(before?.discount ?? 0)}${before?.subtotal ? ` · ${pctOf(amount, before.subtotal).toFixed(1)}% of ${rs(before.subtotal)}` : ''}`;
        reference = billRef;
        figures.push(
          { label: 'Before', value: rs(before?.discount ?? 0) },
          { label: 'After', value: `${rs(amount)}${pct(amount, before?.subtotal)}`, tone: 'warn' },
          ...(before?.subtotal !== undefined ? [{ label: 'Bill subtotal', value: rs(before.subtotal) }] : []),
          ...(before?.subtotal !== undefined ? [{ label: 'New total', value: rs(Math.max(0, before.subtotal - (amount ?? 0))) }] : []),
        );
      } else {
        action = 'Edited bill';
        primary = { label: 'Bill', value: billNo || 'Bill' };
        secondary = changes.length ? `Changed ${changes.map((c) => c.label.toLowerCase()).join(', ')}` : 'No visible change';
      }
    } else if (sub === 'payment') {
      badge = 'Payment';
      reference = billRef;
      if (m === 'PATCH' && parts.length === 3) {
        kind = 'payment';
        action = 'Added payment';
        amount = num(b.amount);
        primary = { label: 'Payment', value: rs(amount) };
        secondary = b.method ? `${cap(str(b.method))} payment` : undefined;
        facts.push({ label: 'Payment amount', value: rs(amount) });
        if (b.method) facts.push({ label: 'Payment method', value: cap(str(b.method)) });
        if (billNo) facts.push({ label: 'Invoice number', value: billNo });
        if (b.method) figures.push({ label: 'Method', value: cap(str(b.method)) });
        if ((num(b.writeoff) ?? 0) > 0) {
          figures.push({ label: 'Write-off', value: rs(num(b.writeoff)), tone: 'warn' });
          facts.push({ label: 'Write-off', value: rs(num(b.writeoff)) });
          flags.push('writeoff');
        }
        if (before?.total !== undefined && !failed) {
          // Balance left on the bill after this payment (payments plus write-offs settle it).
          const settled = (before.payments ?? []).reduce((t, x) => t + (x.amount || 0) + (x.writeoff || 0), 0) + (amount ?? 0) + (num(b.writeoff) ?? 0);
          const due = Math.max(0, before.total - settled);
          figures.push({ label: 'Bill total', value: rs(before.total) });
          figures.push(due > 0 ? { label: 'Still due', value: rs(due), tone: 'bad' } : { label: 'Bill', value: 'Settled', tone: 'good' });
        }
        if (b.date) facts.push({ label: 'Payment date', value: str(b.date).slice(0, 10) });
      } else {
        const i = Number(parts[3]);
        const old = Number.isInteger(i) ? before?.payments?.[i] : undefined;
        if (m === 'DELETE') {
          kind = 'delete';
          action = 'Deleted payment';
          amount = old?.amount;
          primary = { label: 'Payment', value: rs(amount) };
          secondary = old?.method ? `${cap(old.method)} payment` : undefined;
          if (old?.method) figures.push({ label: 'Method', value: cap(old.method) });
          if (old?.writeoff) figures.push({ label: 'Write-off', value: rs(old.writeoff), tone: 'warn' });
          if (old) {
            facts.push({ label: 'Payment amount', value: rs(old.amount) });
            if (old.method) facts.push({ label: 'Payment method', value: cap(old.method) });
          }
        } else {
          kind = 'payment';
          action = 'Edited payment';
          amount = num(b.amount) ?? old?.amount;
          primary = { label: 'Payment', value: rs(amount) };
          changes = diffFields(old as unknown as Record<string, unknown> | undefined, { amount: b.amount, method: b.method, writeoff: b.writeoff });
          secondary = old ? `was ${rs(old.amount)}${old.method ? ` ${old.method}` : ''}` : undefined;
          if (old) figures.push({ label: 'Before', value: rs(old.amount) }, { label: 'After', value: rs(amount), tone: (amount ?? 0) < old.amount ? 'bad' : undefined });
        }
        flags.push('payment_edited');
        if ((num(b.writeoff) ?? 0) > 0) {
          figures.push({ label: 'Write-off', value: rs(num(b.writeoff)), tone: 'warn' });
          flags.push('writeoff');
        }
      }
    } else if (sub === 'items') {
      badge = 'Bill line';
      reference = billRef;
      const price = num(b.price);
      const qty = num(b.quantity) ?? 1;
      const lineValue = price !== undefined ? `${rs(price)}${qty !== 1 ? ` × ${qty}` : ''}` : undefined;
      if (m === 'POST') {
        kind = 'create';
        action = 'Added line';
        if (lineValue) primary = { label: 'Line', value: lineValue };
        facts.push(...recordFacts(b));
      } else if (m === 'DELETE') {
        kind = 'delete';
        action = 'Removed line';
        flags.push('deleted');
      } else {
        action = 'Edited line';
        changes = diffFields(beforeDoc, b);
        if (lineValue) primary = { label: 'Line', value: lineValue };
        if (changes.length) secondary = `Changed ${changes.map((c) => c.label.toLowerCase()).join(', ')}`;
      }
      if (!failed && num(r.total) !== undefined && before?.total !== undefined && num(r.total) !== before.total) {
        changes.push({ field: 'total', label: 'Bill total', from: before.total, to: num(r.total) ?? null, money: true });
      }
    } else if (p === '/invoices/demand') {
      kind = 'create';
      action = 'Logged lost sale';
      badge = 'Lost sale';
      facts.push(...recordFacts(b));
    } else if (p === '/invoices/renumber') {
      action = 'Renumbered all bills';
      badge = 'Bills';
    }
  }

  if (!action) {
    const area = parts[0] ?? '';
    const noun = AREA_LABEL[area] ?? area.replace(/-/g, ' ');
    badge = cap(noun || 'record');
    kind = m === 'DELETE' ? 'delete' : m === 'POST' && parts.length === 1 ? 'create' : 'update';
    action = `${kind === 'delete' ? 'Deleted' : kind === 'create' ? 'Added' : 'Updated'} ${noun}`;
    const name = str(r.name ?? b.name ?? beforeDoc?.name ?? beforeDoc?.houseName);
    const id = parts[1] && /^[A-Za-z0-9_-]{12,}$/.test(parts[1]) ? parts[1] : str(r._id ?? r.id);
    if (name) primary = { label: badge, value: name };
    // Sub-actions with a clear verb (/frames/:id/archive …).
    // /archive toggles: an already archived record is being restored.
    const sub = parts[2] === 'archive' && beforeDoc?.isArchived === true ? 'unarchive' : parts[2];
    const verb = parts.length === 3 ? SUB_ACTION[sub] : undefined;
    if (verb) {
      action = `${verb.verb} ${noun}`;
      if (verb.change) changes.push({ ...verb.change });
      if (kind === 'delete') kind = 'update';
    } else if (parts.length > 2) secondary = cap(parts.slice(2).join(' / ').replace(/-/g, ' '));
    if (kind === 'create') {
      facts.push(...recordFacts(b));
      if (!secondary) secondary = facts.slice(0, 2).map((f) => f.value).join(' · ') || undefined;
    } else if (kind === 'delete') {
      facts.push(...recordFacts(beforeDoc));
      if (id && !secondary) secondary = `ID ${id}`;
      flags.push('deleted');
    } else {
      if (!verb) changes = diffFields(beforeDoc, b);
      else changes.push(...diffFields(beforeDoc, b).filter((c) => !changes.some((x) => x.field === c.field)));
      if (changes.length && !verb) {
        const shown = changes.slice(0, 4).map((c) => c.label.toLowerCase()).join(', ');
        secondary = `Changed ${shown}${changes.length > 4 ? ` +${changes.length - 4} more` : ''}`;
      }
    }
    if (area === 'customers' && name) reference = { type: 'customer', label: 'Customer', value: name, ...(id ? { id } : {}) };
  }

  if (failed) {
    kind = 'failed';
    chips.push(`Failed (${status})`);
  }

  const details = [
    secondary ?? '',
    ...figures.map((f) => `${f.label.toLowerCase()} ${f.value}`),
    ...chips,
    ...changes.map((c) => `${c.label.toLowerCase()} ${fmtChange(c.from, c.money)} → ${fmtChange(c.to, c.money)}`),
  ].filter(Boolean);
  const subject = reference?.value ?? (primary && primary.value !== rs(amount) ? primary.value : '');
  const summary = [action, subject, amount !== undefined ? rs(amount) : '', ...details].filter(Boolean).join(' · ');
  return {
    summary,
    flags: [...new Set(flags)],
    kind,
    category: categoryOf(p),
    action,
    badge,
    ...(primary ? { primary } : {}),
    ...(secondary ? { secondary } : {}),
    ...(reference ? { reference } : {}),
    chips,
    facts,
    figures,
    changes,
    subject,
    ...(amount !== undefined ? { amount } : {}),
    details,
  };
}

/**
 * Display fields for an entry saved by an older version of the log: rebuilt from what it stored
 * (request, bill before the change, amount, subject). Nothing is written back; the saved entry
 * stays as it was.
 */
export function rebuildDisplay(e: {
  method?: string; path?: string; status?: number; body?: string; before?: InvoiceBefore;
  amount?: number; subject?: string; flags?: AuditFlag[];
}): AuditDescription | null {
  if (!e.method || !e.path) return null;
  let body: unknown;
  try {
    body = e.body ? JSON.parse(e.body) : undefined;
  } catch {
    body = undefined;
  }
  const response: Record<string, unknown> = {};
  if (e.subject) {
    if (e.path.startsWith('/invoices')) response.invoiceNumber = e.subject;
    else response.name = e.subject;
  }
  if (e.amount !== undefined && e.method === 'POST' && e.path === '/invoices') response.total = e.amount;
  const d = describe({ method: e.method, path: e.path, status: e.status ?? 200, body, response, before: e.before ?? null });
  return { ...d, flags: [...new Set([...(e.flags ?? []), ...d.flags])] };
}

/** Picks the few response fields the summary uses (never the whole document). */
export function pickResponse(body: unknown): Record<string, unknown> | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const src = ('data' in (body as object) && (body as any).data && typeof (body as any).data === 'object' ? (body as any).data : body) as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const k of ['_id', 'id', 'invoiceNumber', 'name', 'total', 'subtotal', 'discount', 'message']) {
    const v = src[k];
    if (v !== undefined && (typeof v !== 'string' || v.length < 200)) out[k] = v;
  }
  const customer = src.customer as Record<string, unknown> | undefined;
  if (customer && typeof customer === 'object' && typeof customer.name === 'string') out.customerName = customer.name;
  return Object.keys(out).length ? out : null;
}

/** The id the change was about: the segment after the area (/frames/:id/tags → :id). */
export function targetIdOf(path: string, response?: Record<string, unknown> | null): string | undefined {
  const parts = path.split('/').filter(Boolean);
  const fromPath = parts[1];
  if (fromPath && /^[A-Za-z0-9_-]{12,}$/.test(fromPath)) return fromPath;
  const id = response?._id ?? response?.id;
  return id ? String(id) : undefined;
}
