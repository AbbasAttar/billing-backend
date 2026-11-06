import { Request, Response, NextFunction } from 'express';
import { Invoice } from '../models/Invoice.model';
import { InvoiceItem } from '../models/InvoiceItem.model';
import { Customer } from '../models/Customer.model';
import { Frame } from '../models/Frame.model';
import { OpticalLens } from '../models/OpticalLens.model';
import { Fragrance } from '../models/Fragrance.model';
import { Prescription } from '../models/Prescription.model';
import { runModelTransaction } from '../lib/firestoreModel';
import { invalidateInvoiceLookupCache } from './purchaseEntry.controller';
import {
  CostKind,
  costGroups,
  cogsFigures,
  isSharedAccount,
  paginate,
  phoneProblem,
} from '../services/dataQuality';

const idOf = (v: unknown): string =>
  v && typeof v === 'object' ? String((v as any)._id ?? (v as any).id) : v ? String(v) : '';
const isValidId = (v: unknown) => typeof v === 'string' && /^[A-Za-z0-9_-]{6,64}$/.test(v);

const COST_LINE_FIELDS =
  'frame opticalLens isCustomLens type lensType lensCategory lensBrand lensCompany lensName lensIndex lensCoating lensMaterial frameVariantLabel quantity price costPrice returnedQty';

async function loadCostData() {
  const [items, frames, lenses] = await Promise.all([
    InvoiceItem.find({}).select(COST_LINE_FIELDS).lean(),
    Frame.find({}).select('name houseName companyName type costPrice sellPrice stock').lean(),
    OpticalLens.find({}).select('brand name category index coating costPrice').lean(),
  ]);
  return { items: items as any[], frames: frames as any[], lenses: lenses as any[] };
}

/** Invoices with their customer, bill date and line ids. */
async function loadInvoices() {
  return (await Invoice.find({}).select('invoiceNumber billDate createdAt customer total items').lean()) as any[];
}

/** Customers with their bill count, lifetime spend and last bill. */
function customerStats(invoices: any[]) {
  const stats = new Map<string, { count: number; spend: number; last: number }>();
  for (const inv of invoices) {
    const id = idOf(inv.customer);
    if (!id) continue;
    const s = stats.get(id) ?? { count: 0, spend: 0, last: 0 };
    s.count += 1;
    s.spend += inv.total ?? 0;
    s.last = Math.max(s.last, new Date(inv.billDate ?? inv.createdAt ?? 0).getTime() || 0);
    stats.set(id, s);
  }
  return stats;
}

const sharedIdsOf = (customers: any[]) => new Set(customers.filter((c) => isSharedAccount(c)).map((c) => idOf(c._id)));

/** Customers who have bought, are not a shared account, and cannot be reached by phone. */
function phoneQueue(customers: any[], stats: Map<string, { count: number; spend: number; last: number }>, shared: Set<string>) {
  return customers
    .map((c) => ({ c, problem: phoneProblem(c.mobileNumber, c.phoneInvalid), s: stats.get(idOf(c._id)) }))
    .filter((x) => x.problem && x.s && !shared.has(idOf(x.c._id)) && x.c.contactPreference !== 'no_contact')
    .sort((a, b) => b.s!.spend - a.s!.spend || b.s!.last - a.s!.last);
}

// ── GET /data-quality/summary ────────────────────────────────────────────────

export const getSummary = async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const [{ items, frames, lenses }, invoices, customers] = await Promise.all([
      loadCostData(),
      loadInvoices(),
      Customer.find({}).select('name mobileNumber phoneInvalid contactPreference').lean().then((r) => r as any[]),
    ]);
    const frameGroups = costGroups(items, frames, lenses, 'frame');
    const lensGroups = costGroups(items, frames, lenses, 'lens');
    const stats = customerStats(invoices);
    const shared = sharedIdsOf(customers);
    const sharedBills = invoices.filter((inv) => shared.has(idOf(inv.customer)));
    res.json({
      costs: {
        frame: { groups: frameGroups.length, lines: frameGroups.reduce((s, g) => s + g.lines, 0), revenue: frameGroups.reduce((s, g) => s + g.revenue, 0) },
        lens: { groups: lensGroups.length, lines: lensGroups.reduce((s, g) => s + g.lines, 0), revenue: lensGroups.reduce((s, g) => s + g.revenue, 0) },
      },
      sharedBills: { accounts: [...shared].filter((id) => stats.has(id)).length, bills: sharedBills.length, revenue: Math.round(sharedBills.reduce((s, i) => s + (i.total ?? 0), 0)) },
      phones: { customers: phoneQueue(customers, stats, shared).length },
    });
  } catch (error) {
    next(error);
  }
};

// ── Costs ────────────────────────────────────────────────────────────────────

const kindOf = (v: unknown): CostKind | null => (v === 'frame' || v === 'lens' ? v : null);

/** GET /data-quality/costs?kind=frame|lens&page=1&limit=20 — products sold without a cost price, biggest revenue first. */
export const getCostQueue = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const kind = kindOf(req.query.kind);
    if (!kind) {
      res.status(400).json({ message: 'kind must be frame or lens.' });
      return;
    }
    const { items, frames, lenses } = await loadCostData();
    const groups = costGroups(items, frames, lenses, kind);
    const { page, pages, limit, slice } = paginate(groups, req.query.page, req.query.limit);
    res.json({
      kind,
      remaining: groups.length,
      lines: groups.reduce((s, g) => s + g.lines, 0),
      page,
      pages,
      limit,
      groups: slice.map(({ lineIds: _l, lensIds: _ids, ...g }) => g),
    });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /data-quality/costs { kind, key, unitCost } — saves the cost on every uncosted line of that
 * product, refreshes each bill's cost of goods and margin, and saves the cost on the frame / stock
 * lens when it has none, so the next bill picks it up.
 */
export const setGroupCost = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const kind = kindOf(req.body?.kind);
    const key = typeof req.body?.key === 'string' ? req.body.key : '';
    const unitCost = Number(req.body?.unitCost);
    if (!kind || !key) {
      res.status(400).json({ message: 'kind and key are required.' });
      return;
    }
    if (!Number.isFinite(unitCost) || unitCost <= 0 || unitCost > 1_000_000) {
      res.status(400).json({ message: 'Enter a cost above ₹0.' });
      return;
    }
    const cost = Number(unitCost.toFixed(2));

    const [{ items, frames, lenses }, invoices] = await Promise.all([loadCostData(), loadInvoices()]);
    const group = costGroups(items, frames, lenses, kind).find((g) => g.key === key);
    if (!group) {
      res.status(404).json({ message: 'Nothing left to fix for this product — it may already be done.' });
      return;
    }

    // Line → its bill, so each bill's cost of goods is refreshed with its lines.
    const lineSet = new Set(group.lineIds);
    const byInvoice = new Map<string, string[]>();
    for (const inv of invoices) {
      for (const lineId of (inv.items ?? []).map(idOf)) {
        if (!lineSet.has(lineId)) continue;
        const list = byInvoice.get(idOf(inv._id)) ?? [];
        list.push(lineId);
        byInvoice.set(idOf(inv._id), list);
      }
    }

    let updatedLines = 0;
    for (const [invoiceId, lineIds] of byInvoice) {
      await runModelTransaction(async (t) => {
        const invoice = await t.get<any>(Invoice, invoiceId);
        if (!invoice) return;
        const ids = (invoice.items ?? []).map(idOf);
        const lines = await t.getMany<any>(InvoiceItem, ids);
        for (const lineId of lineIds) {
          const line = lines.get(lineId);
          // Someone may have costed it meanwhile; never overwrite a saved cost.
          if (!line || (typeof line.costPrice === 'number' && line.costPrice > 0)) continue;
          await t.update(InvoiceItem, lineId, { $set: { costPrice: cost } }, line);
          lines.set(lineId, { ...line, costPrice: cost });
          updatedLines += 1;
        }
        await t.update(Invoice, invoiceId, { $set: cogsFigures(invoice, ids.map((id: string) => lines.get(id)).filter(Boolean)) }, invoice);
      });
    }

    // Product: only when it has no cost of its own.
    let productUpdated = 0;
    if (kind === 'frame' && group.frameId) {
      const f = frames.find((x) => idOf(x._id) === group.frameId);
      if (f && !(f.costPrice > 0)) {
        await Frame.findByIdAndUpdate(group.frameId, { $set: { costPrice: cost } });
        productUpdated = 1;
      }
    } else if (kind === 'lens' && group.lensIds?.length) {
      for (const id of group.lensIds) {
        const l = lenses.find((x) => idOf(x._id) === id);
        if (l && !(l.costPrice > 0)) {
          await OpticalLens.findByIdAndUpdate(id, { $set: { costPrice: cost } });
          productUpdated += 1;
        }
      }
    }

    if (updatedLines > 0) invalidateInvoiceLookupCache();
    res.json({ updatedLines, bills: byInvoice.size, productUpdated });
  } catch (error) {
    next(error);
  }
};

// ── Shared walk-in accounts ──────────────────────────────────────────────────

/**
 * GET /data-quality/shared-bills?page=1 — bills on a shared account ("Walk-in", "Unknown",
 * placeholder number), newest first, with what was bought and the wearer names typed on the lines.
 */
export const getSharedBills = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const [invoices, customers] = await Promise.all([
      loadInvoices(),
      Customer.find({}).select('name mobileNumber').lean().then((r) => r as any[]),
    ]);
    const stats = customerStats(invoices);
    const shared = sharedIdsOf(customers);
    const accounts = customers
      .filter((c) => shared.has(idOf(c._id)) && stats.has(idOf(c._id)))
      .map((c) => ({ _id: idOf(c._id), name: c.name, mobileNumber: c.mobileNumber ?? '', bills: stats.get(idOf(c._id))?.count ?? 0 }))
      .sort((a, b) => b.bills - a.bills);
    const accountName = new Map(accounts.map((a) => [a._id, a.name]));
    const bills = invoices
      .filter((inv) => shared.has(idOf(inv.customer)))
      .sort((a, b) => new Date(b.billDate ?? b.createdAt ?? 0).getTime() - new Date(a.billDate ?? a.createdAt ?? 0).getTime());
    const { page, pages, limit, slice } = paginate(bills, req.query.page, req.query.limit);

    // Lines for this page only.
    const lineIds = slice.flatMap((inv) => (inv.items ?? []).map(idOf));
    const lines = lineIds.length
      ? ((await InvoiceItem.find({ _id: { $in: lineIds } })
          .select('frame fragrance fragranceGrade itemName lensName lensType lensCategory userName quantity price rightSpherical rightCylinder leftSpherical leftCylinder rightAddition')
          .lean()) as any[])
      : [];
    const frameIds = [...new Set(lines.map((l) => idOf(l.frame)).filter(Boolean))];
    const fragranceIds = [...new Set(lines.map((l) => idOf(l.fragrance)).filter(Boolean))];
    const [frames, fragrances] = await Promise.all([
      frameIds.length ? (Frame.find({ _id: { $in: frameIds } }).select('name houseName companyName').lean().then((r) => r as any[])) : Promise.resolve([]),
      fragranceIds.length ? (Fragrance.find({ _id: { $in: fragranceIds } }).select('name').lean().then((r) => r as any[])) : Promise.resolve([]),
    ]);
    const frameName = new Map(frames.map((f) => [idOf(f._id), [f.companyName, f.houseName || f.name].filter(Boolean).join(' ')]));
    const fragranceName = new Map(fragrances.map((f) => [idOf(f._id), f.name]));
    const lineById = new Map(lines.map((l) => [idOf(l._id), l]));
    const fmtPow = (v: unknown) => (typeof v === 'number' ? (v > 0 ? `+${v.toFixed(2)}` : v.toFixed(2)) : '');

    res.json({
      accounts,
      remaining: bills.length,
      page,
      pages,
      limit,
      bills: slice.map((inv) => {
        const its = (inv.items ?? []).map((id: unknown) => lineById.get(idOf(id))).filter(Boolean);
        const wearers = [...new Set(its.map((l: any) => String(l.userName ?? '').trim()).filter((n: string) => n && !/^walk/i.test(n)))];
        const rx = its
          .filter((l: any) => typeof l.rightSpherical === 'number' || typeof l.leftSpherical === 'number')
          .map((l: any) => `R ${fmtPow(l.rightSpherical)}${l.rightCylinder ? `/${fmtPow(l.rightCylinder)}` : ''} · L ${fmtPow(l.leftSpherical)}${l.leftCylinder ? `/${fmtPow(l.leftCylinder)}` : ''}${l.rightAddition ? ` · Add ${fmtPow(l.rightAddition)}` : ''}`)[0];
        return {
          _id: idOf(inv._id),
          invoiceNumber: inv.invoiceNumber,
          billDate: inv.billDate ?? inv.createdAt,
          total: inv.total ?? 0,
          account: accountName.get(idOf(inv.customer)) ?? '',
          items: its.map((l: any) => {
            const name = l.frame
              ? frameName.get(idOf(l.frame)) || 'Frame'
              : l.fragrance
                ? [fragranceName.get(idOf(l.fragrance)) || 'Fragrance', l.fragranceGrade].filter(Boolean).join(' ')
                : l.lensName || l.lensType || l.lensCategory || l.itemName || 'Item';
            return `${name}${l.quantity > 1 ? ` ×${l.quantity}` : ''}`;
          }),
          wearers,
          rx: rx ?? null,
        };
      }),
    });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /data-quality/shared-bills/:invoiceId { customerId } — moves a bill off the shared account
 * onto the real customer, with the prescriptions saved from its lines.
 */
export const assignSharedBill = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const invoiceId = String(req.params.invoiceId);
    const customerId = req.body?.customerId;
    if (!isValidId(invoiceId) || !isValidId(customerId)) {
      res.status(400).json({ message: 'Pick the customer this bill belongs to.' });
      return;
    }
    const [invoice, customer] = await Promise.all([Invoice.findById(invoiceId).lean().then((r) => r as any), Customer.findById(customerId).lean().then((r) => r as any)]);
    if (!invoice || !customer) {
      res.status(404).json({ message: !invoice ? 'Bill not found.' : 'Customer not found.' });
      return;
    }
    const fromId = idOf(invoice.customer);
    if (fromId === customerId) {
      res.json({ moved: false, prescriptions: 0 });
      return;
    }

    let prescriptions = 0;
    await runModelTransaction(async (t) => {
      const inv = await t.get<any>(Invoice, invoiceId);
      if (!inv) return;
      const lines = await t.getMany<any>(InvoiceItem, (inv.items ?? []).map(idOf));
      const rxIds = [...new Set([...lines.values()].map((l) => idOf(l.prescription)).filter(Boolean))];
      const rxDocs = await t.getMany<any>(Prescription, rxIds);
      await t.update(Invoice, invoiceId, { $set: { customer: customerId } }, inv);
      for (const [rxId, rx] of rxDocs) {
        // Only prescriptions still on the shared account; one already on a real customer stays.
        if (idOf(rx.customer) !== fromId) continue;
        await t.update(Prescription, rxId, { $set: { customer: customerId } }, rx);
        prescriptions += 1;
      }
    });
    invalidateInvoiceLookupCache();
    res.json({ moved: true, prescriptions });
  } catch (error) {
    next(error);
  }
};

// ── Phones ───────────────────────────────────────────────────────────────────

/** GET /data-quality/phones?page=1 — paying customers with no working mobile number, biggest spenders first. */
export const getPhoneQueue = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const [invoices, customers] = await Promise.all([
      loadInvoices(),
      Customer.find({}).select('name mobileNumber phoneInvalid contactPreference address').lean().then((r) => r as any[]),
    ]);
    const stats = customerStats(invoices);
    const shared = sharedIdsOf(customers);
    const queue = phoneQueue(customers, stats, shared);
    const { page, pages, limit, slice } = paginate(queue, req.query.page, req.query.limit);
    res.json({
      remaining: queue.length,
      page,
      pages,
      limit,
      customers: slice.map(({ c, problem, s }) => ({
        _id: idOf(c._id),
        name: c.name,
        mobileNumber: c.mobileNumber ?? '',
        address: c.address ?? '',
        problem,
        bills: s!.count,
        spend: Math.round(s!.spend),
        lastVisit: s!.last ? new Date(s!.last).toISOString() : null,
      })),
    });
  } catch (error) {
    next(error);
  }
};
