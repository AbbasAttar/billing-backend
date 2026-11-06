/**
 * Data-cleanup queues: the gaps that make reports wrong or customers unreachable.
 * - bill lines (frames, lenses) sold without a cost price → margin is unknown
 * - bills on a shared "walk-in" account → the buyer cannot be recalled or remarketed
 * - customers without a working mobile number → no recall, no WhatsApp
 * Pure helpers only; the controller loads the data and writes the fixes.
 */
import { isCatchAllFrame } from './catchAllProducts';

export type CostKind = 'frame' | 'lens';

const idOf = (v: unknown): string =>
  v && typeof v === 'object' ? String((v as { _id?: unknown; id?: unknown })._id ?? (v as { id?: unknown }).id) : v ? String(v) : '';
const clean = (v: unknown) => (typeof v === 'string' ? v.trim() : v === undefined || v === null ? '' : String(v)).replace(/\s+/g, ' ');
const norm = (v: unknown) => clean(v).toLowerCase();

// ── Phone numbers ───────────────────────────────────────────────────────────

export type PhoneProblem = 'missing' | 'wrong_length' | 'placeholder' | 'reported_wrong';

/** Indian mobile: 10 digits starting 6–9, after dropping a +91 / 0 prefix. */
export function normalizeMobile(raw?: string | null): string {
  let d = String(raw ?? '').replace(/\D/g, '');
  if (d.length === 12 && d.startsWith('91')) d = d.slice(2);
  else if (d.length === 11 && d.startsWith('0')) d = d.slice(1);
  return d;
}

const PLACEHOLDERS = new Set(['1234567890', '0123456789', '9876543210']);

export function phoneProblem(raw?: string | null, phoneInvalid?: boolean): PhoneProblem | null {
  if (phoneInvalid) return 'reported_wrong';
  const d = normalizeMobile(raw);
  if (!d) return 'missing';
  if (d.length !== 10) return 'wrong_length';
  if (/^(\d)\1{9}$/.test(d) || PLACEHOLDERS.has(d) || !/^[6-9]/.test(d)) return 'placeholder';
  return null;
}

// ── Shared walk-in accounts ─────────────────────────────────────────────────

const SHARED_NAME =
  /^(walk[\s-]*(in|by)|unknown|guest|cash|counter|customer|client|na|n\/a|none|test|-+|\.+)(\s+(client|customer|sale|sales|account))?$/i;

/**
 * A shared counter account: "Walk-in Client", "Unknown", "Cash"… Named regulars without a number
 * are real customers (they belong in the phone queue), so only the name decides.
 */
export function isSharedAccount(c: { name?: string }): boolean {
  return SHARED_NAME.test(clean(c.name));
}

// ── Lines without a cost price ──────────────────────────────────────────────

export interface CostLine {
  _id: unknown;
  frame?: unknown;
  opticalLens?: unknown;
  isCustomLens?: boolean;
  type?: string;
  lensType?: string;
  lensCategory?: string;
  lensBrand?: string;
  lensCompany?: string;
  lensName?: string;
  lensIndex?: string;
  lensCoating?: string;
  lensMaterial?: string;
  frameVariantLabel?: string;
  quantity?: number;
  price?: number;
  costPrice?: number;
  returnedQty?: number;
}
export interface CostFrame { _id: unknown; name?: string; houseName?: string; companyName?: string; type?: string; costPrice?: number; sellPrice?: number; stock?: number }
export interface CostLens { _id: unknown; brand?: string; name?: string; category?: string; index?: string; coating?: string | null; costPrice?: number }

export interface CostGroup {
  key: string;
  kind: CostKind;
  title: string;
  subtitle: string;
  lines: number;
  units: number;
  revenue: number;
  /** Average billed price per unit, so the cost can be entered for the same unit. */
  avgPrice: number;
  lastPrice: number;
  /** Cost already saved on the product (frame / stock lens), offered as the answer. */
  productCost: number | null;
  /** Cost other lines of the same group were billed at (most common), offered when no product cost. */
  suggestedCost: number | null;
  lineIds: string[];
  frameId?: string;
  lensIds?: string[];
}

const hasCost = (it: CostLine) => typeof it.costPrice === 'number' && it.costPrice > 0;
const isFrameLine = (it: CostLine) => !!(it.frame || it.type === 'frame');
const isLensLine = (it: CostLine) => !!(it.opticalLens || it.isCustomLens || it.type === 'opticalLens' || it.lensType || it.lensCategory);

/** One key per lens product: brand, name, category, index, coating (material for unnamed custom lenses). */
function lensSpec(it: CostLine, lens?: CostLens) {
  const brand = clean(lens?.brand ?? it.lensBrand ?? it.lensCompany);
  const name = clean(lens?.name ?? it.lensName ?? (it.lensType !== it.lensCategory ? it.lensType : ''));
  const category = clean(lens?.category ?? it.lensCategory ?? it.lensType);
  const index = clean(lens?.index ?? it.lensIndex);
  const coating = clean(lens?.coating ?? it.lensCoating);
  const material = lens ? '' : clean(it.lensMaterial);
  const key = ['lens', brand, name, category, index, coating, material].map(norm).join('|');
  const title = [brand, name].filter(Boolean).join(' ') || category || 'Lens';
  const subtitle = [category !== title ? category : '', index && `Index ${index}`, coating, material].filter(Boolean).join(' · ');
  return { key, title, subtitle };
}

const mode = (values: number[]): number | null => {
  if (!values.length) return null;
  const counts = new Map<number, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0][0];
};

/**
 * Groups sold frame / lens lines that have no cost price by product, biggest revenue first.
 * Catch-all frames ("Unknown", "Quick Add", "Wholesale") are left out: they have no real cost.
 * Lines fully returned or billed at ₹0 are left out too (they do not affect margin).
 */
export function costGroups(items: CostLine[], frames: CostFrame[], lenses: CostLens[], kind: CostKind): CostGroup[] {
  const frameById = new Map(frames.map((f) => [idOf(f._id), f]));
  const lensById = new Map(lenses.map((l) => [idOf(l._id), l]));
  const groups = new Map<string, CostGroup & { prices: number[]; costs: number[] }>();
  const costsByKey = new Map<string, number[]>();

  for (const it of items) {
    const qty = it.quantity && it.quantity > 0 ? it.quantity : 1;
    const price = it.price ?? 0;
    let key: string, title: string, subtitle: string, frameId: string | undefined, lensId: string | undefined;
    let productCost: number | null = null;

    if (kind === 'frame') {
      if (!isFrameLine(it)) continue;
      frameId = idOf(it.frame);
      const f = frameById.get(frameId);
      if (!f || isCatchAllFrame(f)) continue;
      key = `frame|${frameId}`;
      title = clean(f.houseName) || clean(f.name) || 'Frame';
      subtitle = [clean(f.companyName), clean(f.name) !== title ? clean(f.name) : '', clean(f.type)].filter(Boolean).join(' · ');
      productCost = f.costPrice && f.costPrice > 0 ? f.costPrice : null;
    } else {
      if (isFrameLine(it) || !isLensLine(it)) continue;
      lensId = it.opticalLens ? idOf(it.opticalLens) : undefined;
      const l = lensId ? lensById.get(lensId) : undefined;
      ({ key, title, subtitle } = lensSpec(it, l));
      productCost = l?.costPrice && l.costPrice > 0 ? l.costPrice : null;
    }

    if (hasCost(it)) {
      const list = costsByKey.get(key) ?? [];
      list.push(it.costPrice as number);
      costsByKey.set(key, list);
      continue;
    }
    if (price <= 0 || (it.returnedQty ?? 0) >= qty) continue;

    const g = groups.get(key) ?? {
      key, kind, title, subtitle, lines: 0, units: 0, revenue: 0, avgPrice: 0, lastPrice: 0,
      productCost: null, suggestedCost: null, lineIds: [], prices: [], costs: [],
      ...(frameId ? { frameId } : {}), ...(kind === 'lens' ? { lensIds: [] } : {}),
    };
    g.lines += 1;
    g.units += qty;
    g.revenue += qty * price;
    g.lastPrice = price;
    g.prices.push(price);
    g.lineIds.push(idOf(it._id));
    if (productCost !== null && g.productCost === null) g.productCost = productCost;
    if (lensId && g.lensIds && !g.lensIds.includes(lensId)) g.lensIds.push(lensId);
    groups.set(key, g);
  }

  return [...groups.values()]
    .map(({ prices: _p, costs: _c, ...g }) => ({
      ...g,
      revenue: Math.round(g.revenue),
      avgPrice: g.units ? Math.round(g.revenue / g.units) : 0,
      suggestedCost: g.productCost ?? mode(costsByKey.get(g.key) ?? []),
    }))
    .sort((a, b) => b.revenue - a.revenue || a.key.localeCompare(b.key));
}

/**
 * Cost of goods and contribution for a bill from its lines, as the invoice stores them
 * (same formula as the invoice controller). Only these three fields change when a cost is filled in.
 */
export function cogsFigures(
  invoice: { total?: number; packagingCost?: number; paymentProcessingFee?: number },
  lines: { quantity?: number; costPrice?: number }[],
) {
  const totalCogs = Number(lines.reduce((s, it) => s + (typeof it.costPrice === 'number' ? it.costPrice : 0) * (it.quantity ?? 0), 0).toFixed(2));
  const total = invoice.total ?? 0;
  const net = Math.max(0, Number((total - totalCogs - (invoice.packagingCost ?? 0) - (invoice.paymentProcessingFee ?? 0)).toFixed(2)));
  return {
    totalCogs,
    netContributionMargin: net,
    contributionMarginPct: total > 0 ? Number(((net / total) * 100).toFixed(2)) : 0,
  };
}

export const paginate = <T>(list: T[], pageRaw: unknown, limitRaw: unknown, fallback = 20) => {
  const limit = Math.min(Math.max(parseInt(String(limitRaw)) || fallback, 5), 100);
  const pages = Math.max(1, Math.ceil(list.length / limit));
  const page = Math.min(Math.max(parseInt(String(pageRaw)) || 1, 1), pages);
  return { page, pages, limit, slice: list.slice((page - 1) * limit, page * limit) };
};
