import { getDb, snapToData } from '../lib/firestoreDb';
import { recordReads } from '../lib/readMeter';
import { LensPricing } from '../models/LensPricing.model';

type Doc = Record<string, any>;

/**
 * Targeted invoice lookup for purchase entries.
 *
 * The ledger used to download every invoice, invoice item and customer (about 2,700 reads) and keep
 * them in an instance-local cache that Cloud Functions discards on every cold start. This resolves
 * only the invoices a page of entries actually refers to.
 */
export interface InvoiceLookup {
  invoicesByNumber: Map<string, any>;
  invoicesById: Map<string, any>;
  invoicesByItemId: Map<string, any>;
  invoiceItemsMap: Map<string, any>;
}

const DOC_ID_RE = /^[A-Za-z0-9]{20}$/;

function cleanItemRef(importedFrom: unknown): string {
  return String(importedFrom ?? '').replace(/_(re|le)$/, '').replace(/^rx_/, '').trim();
}

/** Likely stored spellings of an invoice number reference ("inv0123/26-27", " INV0123/26-27 "). */
function numberVariants(ref: string): string[] {
  const out = new Set<string>();
  const trimmed = ref.trim();
  if (!trimmed) return [];
  out.add(trimmed);
  out.add(trimmed.toUpperCase());
  // "INV-123/26-27", "inv 123 26-27" -> "INV0123/26-27"
  const m = trimmed.match(/^inv[-\s]?0*(\d+)[\/\s-]*(\d{2}-\d{2})$/i);
  if (m) out.add(`INV${m[1].padStart(4, '0')}/${m[2]}`);
  return [...out];
}

async function getByIds(collection: string, ids: Iterable<string>): Promise<Map<string, Doc>> {
  const unique = [...new Set([...ids].filter(Boolean))];
  const result = new Map<string, Doc>();
  if (unique.length === 0) return result;

  const db = getDb();
  const col = db.collection(collection);
  for (let i = 0; i < unique.length; i += 100) {
    const snaps = await db.getAll(...unique.slice(i, i + 100).map((id) => col.doc(id)));
    recordReads(collection, snaps.length);
    for (const snap of snaps) {
      const data = snapToData<Doc>(snap);
      if (data) result.set(snap.id, data);
    }
  }
  return result;
}

async function queryInvoicesByNumbers(numbers: string[]): Promise<Doc[]> {
  const unique = [...new Set(numbers.filter(Boolean))];
  const found: Doc[] = [];
  const col = getDb().collection('invoices');
  for (let i = 0; i < unique.length; i += 30) {
    const snap = await col.where('invoiceNumber', 'in', unique.slice(i, i + 30)).get();
    recordReads('invoices', Math.max(snap.size, 1));
    found.push(...snap.docs.map((d) => snapToData<Doc>(d)!));
  }
  return found;
}

/** Invoice that contains the given line item, for items that carry no invoice link of their own. */
async function findInvoiceByItemId(itemId: string): Promise<Doc | null> {
  const snap = await getDb().collection('invoices').where('items', 'array-contains', itemId).limit(1).get();
  recordReads('invoices', Math.max(snap.size, 1));
  return snap.empty ? null : snapToData<Doc>(snap.docs[0]);
}

function resolveItems(inv: Doc, itemsById: Map<string, Doc>) {
  const ids: any[] = Array.isArray(inv.items) ? inv.items : [];
  return ids
    .map((rawId) => {
      const it = itemsById.get(String(rawId));
      if (!it) return null;
      return {
        id: String(rawId),
        type: it.type || (it.lensType ? 'lens' : 'item'),
        lensType: it.lensType,
        lensMaterial: it.lensMaterial,
        lensCoating: it.lensCoating,
        lensColor: it.lensColor || 'White',
        lensLabel: it.lensLabel,
        userName: it.userName,
        sph: it.spherical ?? it.rightSpherical ?? it.leftSpherical ?? null,
        cyl: it.cylinder ?? it.rightCylinder ?? it.leftCylinder ?? null,
        add: it.addition ?? it.rightAddition ?? it.leftAddition ?? null,
        rSph: it.rightSpherical ?? it.spherical ?? null,
        rCyl: it.rightCylinder ?? it.cylinder ?? null,
        rAdd: it.rightAddition ?? it.addition ?? null,
        lSph: it.leftSpherical ?? it.spherical ?? null,
        lCyl: it.leftCylinder ?? it.cylinder ?? null,
        lAdd: it.leftAddition ?? it.addition ?? null,
        price: it.price,
      };
    })
    .filter(Boolean);
}

export async function buildInvoiceLookupForEntries(entries: Doc[]): Promise<InvoiceLookup> {
  const numberRefs: string[] = [];
  const invoiceIds = new Set<string>();
  const itemRefs = new Set<string>();

  for (const e of entries) {
    if (e.supplierInvoiceRef) {
      const ref = String(e.supplierInvoiceRef).trim();
      numberRefs.push(...numberVariants(ref));
      if (DOC_ID_RE.test(ref)) invoiceIds.add(ref);
    }
    if (e.purchaseInvoiceId) {
      const pid = String(e.purchaseInvoiceId).trim();
      numberRefs.push(...numberVariants(pid));
      if (DOC_ID_RE.test(pid)) invoiceIds.add(pid);
    }
    if (e.importedFrom) itemRefs.add(cleanItemRef(e.importedFrom));
  }

  // Items the entries were imported from (and the invoice each belongs to)
  const itemsById = await getByIds('invoiceitems', itemRefs);
  const invoiceForItem = new Map<string, string>();
  const unlinkedItemIds: string[] = [];
  for (const itemId of itemRefs) {
    const item = itemsById.get(itemId);
    const linked = item && (item.invoice?.id || item.invoice?._id || item.invoice || item.invoiceId);
    if (linked && typeof linked === 'string') {
      invoiceForItem.set(itemId, linked);
      invoiceIds.add(linked);
    } else {
      unlinkedItemIds.push(itemId);
    }
  }

  const [byNumber, byId, reverse] = await Promise.all([
    queryInvoicesByNumbers(numberRefs),
    getByIds('invoices', invoiceIds),
    Promise.all(unlinkedItemIds.map(async (id) => [id, await findInvoiceByItemId(id)] as const)),
  ]);

  const invoices = new Map<string, Doc>();
  for (const inv of [...byNumber, ...byId.values()]) invoices.set(String(inv.id || inv._id), inv);
  for (const [itemId, inv] of reverse) {
    if (!inv) continue;
    invoices.set(String(inv.id || inv._id), inv);
    invoiceForItem.set(itemId, String(inv.id || inv._id));
  }

  // Customers and any items of the resolved invoices that we do not have yet
  const customerIds = new Set<string>();
  const missingItemIds = new Set<string>();
  for (const inv of invoices.values()) {
    if (inv.customer) customerIds.add(String(inv.customer));
    for (const itId of Array.isArray(inv.items) ? inv.items : []) {
      if (!itemsById.has(String(itId))) missingItemIds.add(String(itId));
    }
  }
  const [customers, moreItems] = await Promise.all([
    getByIds('customers', customerIds),
    getByIds('invoiceitems', missingItemIds),
  ]);
  for (const [id, it] of moreItems) itemsById.set(id, it);

  const lookup: InvoiceLookup = {
    invoicesByNumber: new Map(),
    invoicesById: new Map(),
    invoicesByItemId: new Map(),
    invoiceItemsMap: itemsById,
  };

  for (const inv of invoices.values()) {
    const invId = String(inv.id || inv._id);
    const invNum = inv.invoiceNumber || `INV-${invId.slice(-6)}`;
    const invData = {
      id: invId,
      invoiceNumber: invNum,
      customerName: customers.get(String(inv.customer))?.name || 'Customer',
      billDate: inv.billDate || inv.createdAt,
      total: inv.total,
      items: resolveItems(inv, itemsById),
    };
    lookup.invoicesById.set(invId, invData);
    lookup.invoicesByNumber.set(invNum.toLowerCase().trim(), invData);
    const cleanNum = invNum.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
    if (cleanNum) lookup.invoicesByNumber.set(cleanNum, invData);
    for (const itId of Array.isArray(inv.items) ? inv.items : []) {
      lookup.invoicesByItemId.set(String(itId), invData);
    }
  }
  // Items that pointed at an invoice through their own link, even if it lists no items array.
  for (const [itemId, invId] of invoiceForItem) {
    const invData = lookup.invoicesById.get(invId);
    if (invData && !lookup.invoicesByItemId.has(itemId)) lookup.invoicesByItemId.set(itemId, invData);
  }

  return lookup;
}

// ── Lens pricing rules: small table read on every ledger load ───────────────

const PRICING_TTL_MS = 2 * 60 * 1000;
let pricingCache: { rules: any[]; expiresAt: number } | null = null;

export async function getLensPricingRulesCached(): Promise<any[]> {
  if (pricingCache && pricingCache.expiresAt > Date.now()) return pricingCache.rules;
  const rules = await LensPricing.find({}).lean();
  pricingCache = { rules, expiresAt: Date.now() + PRICING_TTL_MS };
  return rules;
}

export function invalidateLensPricingCache(): void {
  pricingCache = null;
}
