import { Request, Response, NextFunction } from 'express';
import { PurchaseEntry } from '../models/PurchaseEntry.model';
import { LensStock } from '../models/LensStock.model';
import { InvoiceItem } from '../models/InvoiceItem.model';
import { Invoice } from '../models/Invoice.model';
import { Customer } from '../models/Customer.model';
import { Prescription } from '../models/Prescription.model';
import { LensPricing, LENS_TYPES, LENS_MATERIALS, LENS_COLORS } from '../models/LensPricing.model';
import { getDb } from '../lib/firestoreDb';

// ── Validation ────────────────────────────────────────────────────────────────

const EYE_VALUES = ['right', 'left', 'both'] as const;
type EyeValue = typeof EYE_VALUES[number];

interface RawEntry {
  lensType:      unknown;
  material:      unknown;
  coating:       unknown;
  color?:        unknown;
  brand?:        unknown;
  eye?:          unknown;
  sph:           unknown;
  cyl?:          unknown;
  add?:          unknown;
  qty:           unknown;
  costPerPair?:  unknown;
  unitCost?:     unknown;
  unitSellPrice?: unknown;
  lensPricingId?: unknown;
  pricingSource?: unknown;
  updateMasterPricing?: unknown;
  supplier?:     unknown;
  supplierInvoiceRef?: unknown;
  purchaseInvoiceId?: unknown;
  notes?:        unknown;
  purchaseDate?: unknown;
}

interface BatchInvoiceHeader {
  supplier?: string;
  supplierInvoiceRef?: string;
  purchaseInvoiceId?: string;
  brand?: string;
  purchaseDate?: string;
  pricingDisplay?: 'pair' | 'lens';
}

function validateEntry(raw: RawEntry, idx: number): string | null {
  if (!LENS_TYPES.includes(raw.lensType as typeof LENS_TYPES[number]))
    return `Entry ${idx + 1}: invalid lensType "${raw.lensType}".`;
  if (!LENS_MATERIALS.includes(raw.material as typeof LENS_MATERIALS[number]))
    return `Entry ${idx + 1}: invalid material "${raw.material}".`;
  if (raw.color && !LENS_COLORS.includes(raw.color as typeof LENS_COLORS[number]))
    return `Entry ${idx + 1}: invalid color "${raw.color}".`;
  if (typeof raw.coating !== 'string' || !raw.coating.trim())
    return `Entry ${idx + 1}: coating is required.`;
  if (typeof raw.sph !== 'number')
    return `Entry ${idx + 1}: sph must be a number.`;
  if (raw.cyl !== undefined && raw.cyl !== null && typeof raw.cyl !== 'number')
    return `Entry ${idx + 1}: cyl must be a number.`;
  if (raw.add !== undefined && raw.add !== null && typeof raw.add !== 'number')
    return `Entry ${idx + 1}: add must be a number or null.`;
  if (typeof raw.qty !== 'number' || raw.qty <= 0)
    return `Entry ${idx + 1}: qty must be a positive number.`;

  // Cost validation: either unitCost or costPerPair must be provided
  const cost = raw.unitCost !== undefined && raw.unitCost !== null
    ? Number(raw.unitCost)
    : raw.costPerPair !== undefined && raw.costPerPair !== null
    ? Number(raw.costPerPair) / 2
    : null;

  if (cost === null || isNaN(cost) || cost < 0) {
    return `Entry ${idx + 1}: valid cost (unitCost or costPerPair >= 0) is required.`;
  }
  return null;
}

// ── POST /api/purchases — bulk create (Log Purchase, status=received) ─────────

export const createPurchaseEntries = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    let header: BatchInvoiceHeader = {};
    let entriesRaw: RawEntry[] = [];

    if (Array.isArray(req.body)) {
      entriesRaw = req.body;
    } else if (req.body && typeof req.body === 'object') {
      header = req.body.header || {};
      entriesRaw = req.body.items || [];
    }

    if (!Array.isArray(entriesRaw) || entriesRaw.length === 0) {
      res.status(400).json({ message: 'Request body must contain a non-empty array of lens purchase items.' });
      return;
    }

    for (let i = 0; i < entriesRaw.length; i++) {
      const err = validateEntry(entriesRaw[i] as RawEntry, i);
      if (err) {
        res.status(400).json({ message: err });
        return;
      }
    }

    const created: unknown[] = [];

    for (const raw of entriesRaw) {
      const lensType    = raw.lensType    as typeof LENS_TYPES[number];
      const material    = raw.material    as typeof LENS_MATERIALS[number];
      const coating     = (raw.coating as string).trim();
      const color       = (raw.color as typeof LENS_COLORS[number]) || 'White';
      const brand       = (raw.brand ? String(raw.brand).trim() : header.brand ? String(header.brand).trim() : null);
      const eye         = EYE_VALUES.includes(raw.eye as EyeValue) ? (raw.eye as EyeValue) : 'both';
      const sph         = raw.sph         as number;
      const cyl         = typeof raw.cyl === 'number'  ? raw.cyl  : 0;
      const add         = typeof raw.add === 'number'  ? raw.add  : null;
      const qty         = raw.qty         as number;

      // Standardize on unitCost (single eye / per lens)
      let unitCost: number;
      if (raw.unitCost !== undefined && raw.unitCost !== null && !isNaN(Number(raw.unitCost))) {
        unitCost = Number(raw.unitCost);
      } else if (raw.costPerPair !== undefined && raw.costPerPair !== null && !isNaN(Number(raw.costPerPair))) {
        unitCost = Number(raw.costPerPair) / 2;
      } else {
        unitCost = 0;
      }

      const costPerPair = Math.round(unitCost * 2 * 100) / 100;
      const unitSellPrice = raw.unitSellPrice !== undefined && raw.unitSellPrice !== null && !isNaN(Number(raw.unitSellPrice))
        ? Number(raw.unitSellPrice)
        : null;

      const lensPricingId = raw.lensPricingId ? String(raw.lensPricingId) : null;
      const pricingSource = (raw.pricingSource as any) || (lensPricingId ? 'matrix' : 'manual');
      const supplier = raw.supplier ? String(raw.supplier).trim() : header.supplier ? String(header.supplier).trim() : null;
      const supplierInvoiceRef = raw.supplierInvoiceRef ? String(raw.supplierInvoiceRef).trim() : header.supplierInvoiceRef ? String(header.supplierInvoiceRef).trim() : null;
      const purchaseInvoiceId = raw.purchaseInvoiceId ? String(raw.purchaseInvoiceId).trim() : header.purchaseInvoiceId ? String(header.purchaseInvoiceId).trim() : null;

      let purchaseDate: Date;
      const dateStr = raw.purchaseDate || header.purchaseDate;
      if (dateStr) {
        purchaseDate = new Date(dateStr as string);
        if (isNaN(purchaseDate.getTime())) {
          purchaseDate = new Date();
        }
      } else {
        purchaseDate = new Date();
      }

      const entry = await PurchaseEntry.create({
        status: 'received',
        lensType,
        material,
        coating,
        color,
        brand,
        eye,
        sph,
        cyl,
        add,
        qty,
        unitCost,
        unitSellPrice,
        costPerPair,
        lensPricingId,
        pricingSource,
        supplier,
        supplierInvoiceRef,
        purchaseInvoiceId,
        notes: raw.notes ? String(raw.notes).trim() : null,
        purchaseDate,
      });

      // Update LensStock with total individual lenses and unit cost
      const totalLenses = eye === 'both' ? qty * 2 : qty;
      await LensStock.findOneAndUpdate(
        { lensType, material, coating, color, sph, cyl, add },
        {
          $inc: { quantity: totalLenses },
          $set: { lastCost: unitCost, costPrice: unitCost },
          $setOnInsert: { reorderLevel: 2 },
        },
        { upsert: true, new: true, runValidators: false },
      );

      // Handle "Update Master Pricing" if user checked it
      if (raw.updateMasterPricing) {
        try {
          if (lensPricingId) {
            const rule = await LensPricing.findById(lensPricingId);
            if (rule) {
              if (unitCost > 0) rule.costPrice = unitCost;
              if (unitSellPrice !== null && unitSellPrice > 0) rule.price = unitSellPrice;
              await rule.save();
            }
          } else if (unitCost > 0) {
            // Create a new master rule
            await LensPricing.create({
              lensType,
              material,
              coating,
              color,
              axisType: 'any',
              minSph: sph,
              maxSph: sph,
              minCyl: cyl,
              maxCyl: cyl,
              minAdd: add,
              maxAdd: add,
              costPrice: unitCost,
              price: unitSellPrice !== null && unitSellPrice > 0 ? unitSellPrice : Math.round(unitCost * 2.5),
              brand: brand || undefined,
            });
          }
        } catch (ruleErr) {
          console.error('[createPurchaseEntries] Failed to update master pricing rule:', ruleErr);
        }
      }

      created.push(entry);
    }

    res.status(201).json({ count: created.length, entries: created });
  } catch (error) {
    next(error);
  }
};

// ── POST /api/purchases/pending — create pending entries from wholesale order ──

interface PendingItemInput {
  name:      string;
  qty:       number;
  sph?:      number | null;
  cyl?:      number | null;
  add?:      number | null;
  eye?:      'right' | 'left' | 'both';
  lensType?: string | null;
  material?: string | null;
  coating?:  string | null;
  color?:    string | null;
}

export const createPendingEntries = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const body = req.body;

    if (!Array.isArray(body) || body.length === 0) {
      res.status(400).json({ message: 'Request body must be a non-empty array.' });
      return;
    }

    for (let i = 0; i < body.length; i++) {
      const item = body[i] as PendingItemInput;
      if (typeof item.name !== 'string' || !item.name.trim())
        return void res.status(400).json({ message: `Item ${i + 1}: name is required.` });
      if (typeof item.qty !== 'number' || item.qty <= 0)
        return void res.status(400).json({ message: `Item ${i + 1}: qty must be a positive number.` });
    }

    const created = await PurchaseEntry.insertMany(
      (body as PendingItemInput[]).map((item) => ({
        status:       'pending',
        qty:          item.qty,
        notes:        item.name.trim(),
        lensType:     item.lensType  ? (LENS_TYPES.includes(item.lensType as typeof LENS_TYPES[number]) ? item.lensType : null) : null,
        material:     item.material  ? (LENS_MATERIALS.includes(item.material as typeof LENS_MATERIALS[number]) ? item.material : null) : null,
        coating:      item.coating   ? item.coating.trim() : null,
        color:        item.color     ? (LENS_COLORS.includes(item.color as typeof LENS_COLORS[number]) ? item.color : null) : null,
        sph:          typeof item.sph === 'number' ? item.sph : null,
        cyl:          typeof item.cyl === 'number' ? item.cyl : 0,
        add:          typeof item.add === 'number' ? item.add : null,
        eye:          EYE_VALUES.includes(item.eye as EyeValue) ? item.eye : 'both',
        purchaseDate: new Date(),
      })),
    );

    res.status(201).json({ count: created.length, entries: created });
  } catch (error) {
    next(error);
  }
};

// ── PATCH /api/purchases/receive — mark pending entries as received ────────────

interface ReceiveItemInput {
  id:                  string;
  costPerPair?:        number;
  unitCost?:           number;
  unitSellPrice?:      number;
  lensPricingId?:      string;
  brand?:              string;
  updateMasterPricing?: boolean;
  lensType?:           string;
  material?:           string;
  coating?:            string;
  color?:              string;
  sph?:                number;
  cyl?:                number;
  add?:                number | null;
}

export const markReceived = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const body = req.body;

    if (!Array.isArray(body) || body.length === 0) {
      res.status(400).json({ message: 'Request body must be a non-empty array.' });
      return;
    }

    const updated: unknown[] = [];
    const errors: Array<{ id: string; error: string }> = [];

    // Helper to process one item
    const processSingleItem = async (item: ReceiveItemInput) => {
      if (typeof item.id !== 'string' || !item.id.trim()) {
        errors.push({ id: (item as any)?.id || 'unknown', error: 'id is required' });
        return;
      }

      // Determine unitCost
      let unitCost: number;
      if (item.unitCost !== undefined && item.unitCost !== null && !isNaN(Number(item.unitCost))) {
        unitCost = Number(item.unitCost);
      } else if (typeof item.costPerPair === 'number' && item.costPerPair >= 0) {
        unitCost = item.costPerPair / 2;
      } else {
        unitCost = 0;
      }

      const costPerPair = Math.round(unitCost * 2 * 100) / 100;

      const entry = await PurchaseEntry.findById(item.id);
      if (!entry) {
        errors.push({ id: item.id, error: 'Entry not found' });
        return;
      }

      const wasAlreadyReceived = entry.status === 'received';

      // Apply any SKU overrides from request body
      if (item.lensType && LENS_TYPES.includes(item.lensType as typeof LENS_TYPES[number]))
        entry.lensType = item.lensType as typeof LENS_TYPES[number];
      if (item.material && LENS_MATERIALS.includes(item.material as typeof LENS_MATERIALS[number]))
        entry.material = item.material as typeof LENS_MATERIALS[number];
      if (item.coating && item.coating.trim()) entry.coating = item.coating.trim();
      if (item.color && LENS_COLORS.includes(item.color as typeof LENS_COLORS[number]))
        entry.color = item.color as typeof LENS_COLORS[number];
      if (item.brand) entry.brand = item.brand.trim();
      if (item.sph !== undefined) entry.sph = item.sph;
      if (item.cyl !== undefined) entry.cyl = item.cyl;
      if (item.add !== undefined) entry.add = item.add;
      if (item.lensPricingId) entry.lensPricingId = item.lensPricingId;
      if (item.unitSellPrice !== undefined && item.unitSellPrice !== null) {
        entry.unitSellPrice = Number(item.unitSellPrice);
      }

      entry.status      = 'received';
      entry.unitCost    = unitCost;
      entry.costPerPair = costPerPair;
      await entry.save();

      // Update LensStock only when complete SKU is available
      const lt   = entry.lensType;
      const mat  = entry.material;
      const coat = entry.coating;
      const col  = entry.color;
      const sph  = entry.sph;
      const cylVal = typeof entry.cyl === 'number' ? entry.cyl : 0;
      const addVal = typeof entry.add === 'number' ? entry.add : null;

      if (lt && mat && coat && col && sph !== null) {
        const totalLenses = entry.eye === 'both' ? entry.qty * 2 : entry.qty;
        const stockUpdate: any = {
          $set: { lastCost: unitCost, costPrice: unitCost },
          $setOnInsert: { reorderLevel: 2 },
        };
        // Only increment inventory quantity if not already previously received to prevent double counting
        if (!wasAlreadyReceived) {
          stockUpdate.$inc = { quantity: totalLenses };
        }

        try {
          await LensStock.findOneAndUpdate(
            { lensType: lt, material: mat, coating: coat, color: col, sph, cyl: cylVal, add: addVal },
            stockUpdate,
            { upsert: true, new: true, runValidators: false },
          );
        } catch (stockErr) {
          console.error(`[markReceived] Failed to update LensStock for entry ${entry.id}:`, stockErr);
        }
      }

      // Handle Update Master Pricing
      if (item.updateMasterPricing) {
        try {
          if (item.lensPricingId) {
            const rule = await LensPricing.findById(item.lensPricingId);
            if (rule) {
              if (unitCost > 0) rule.costPrice = unitCost;
              if (item.unitSellPrice) rule.price = Number(item.unitSellPrice);
              await rule.save();
            }
          } else if (unitCost > 0 && lt && mat && coat && sph !== null) {
            await LensPricing.create({
              lensType: lt,
              material: mat,
              coating: coat,
              color: col || 'White',
              axisType: 'any',
              minSph: sph,
              maxSph: sph,
              minCyl: cylVal,
              maxCyl: cylVal,
              minAdd: addVal,
              maxAdd: addVal,
              costPrice: unitCost,
              price: item.unitSellPrice ? Number(item.unitSellPrice) : Math.round(unitCost * 2.5),
              brand: item.brand || entry.brand || undefined,
            });
          }
        } catch (ruleErr) {
          console.error('[markReceived] Failed to update master pricing rule:', ruleErr);
        }
      }

      updated.push(entry);
    };

    // Process in parallel chunks of 15 items for high performance and concurrency
    const CHUNK_SIZE = 15;
    for (let i = 0; i < body.length; i += CHUNK_SIZE) {
      const chunk = body.slice(i, i + CHUNK_SIZE) as ReceiveItemInput[];
      await Promise.all(chunk.map((item) => processSingleItem(item)));
    }

    res.json({
      count: updated.length,
      total: body.length,
      entries: updated,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (error) {
    next(error);
  }
};

// ── PATCH /api/purchases/:id — update single purchase entry (e.g. unitCost, supplier, notes, qty) ──

export const updatePurchaseEntry = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { id } = req.params;
    const {
      unitCost,
      costPerPair,
      unitSellPrice,
      lensPricingId,
      pricingSource,
      supplier,
      supplierInvoiceRef,
      purchaseInvoiceId,
      brand,
      notes,
      qty,
      lensType,
      material,
      coating,
      color,
      eye,
      sph,
      cyl,
      add,
      updateMasterPricing,
    } = req.body;

    const entry = await PurchaseEntry.findById(id);
    if (!entry) {
      res.status(404).json({ message: 'Purchase entry not found.' });
      return;
    }

    if (unitCost !== undefined) {
      const parsedCost = unitCost === null || unitCost === '' ? null : Number(unitCost);
      if (parsedCost !== null && (isNaN(parsedCost) || parsedCost < 0)) {
        res.status(400).json({ message: 'unitCost must be a non-negative number.' });
        return;
      }
      entry.unitCost = parsedCost;
      entry.costPerPair = parsedCost !== null ? Math.round(parsedCost * 2 * 100) / 100 : null;
    } else if (costPerPair !== undefined) {
      const parsedCost = costPerPair === null || costPerPair === '' ? null : Number(costPerPair);
      if (parsedCost !== null && (isNaN(parsedCost) || parsedCost < 0)) {
        res.status(400).json({ message: 'costPerPair must be a non-negative number.' });
        return;
      }
      entry.costPerPair = parsedCost;
      entry.unitCost = parsedCost !== null ? Math.round((parsedCost / 2) * 100) / 100 : null;
    }

    if (unitSellPrice !== undefined) {
      entry.unitSellPrice = unitSellPrice === null || unitSellPrice === '' ? null : Number(unitSellPrice);
    }
    if (lensPricingId !== undefined) entry.lensPricingId = lensPricingId;
    if (pricingSource !== undefined) entry.pricingSource = pricingSource;
    if (brand !== undefined) entry.brand = brand ? String(brand).trim() : null;
    if (supplierInvoiceRef !== undefined) entry.supplierInvoiceRef = supplierInvoiceRef ? String(supplierInvoiceRef).trim() : null;
    if (purchaseInvoiceId !== undefined) entry.purchaseInvoiceId = purchaseInvoiceId ? String(purchaseInvoiceId).trim() : null;
    if (supplier !== undefined) entry.supplier = supplier ? String(supplier).trim() : null;
    if (notes !== undefined) entry.notes = notes ? String(notes).trim() : null;
    if (qty !== undefined) {
      const parsedQty = Number(qty);
      if (isNaN(parsedQty) || parsedQty <= 0) {
        res.status(400).json({ message: 'qty must be a positive number.' });
        return;
      }
      entry.qty = parsedQty;
    }

    if (lensType !== undefined && (lensType === null || LENS_TYPES.includes(lensType))) {
      entry.lensType = lensType;
    }
    if (material !== undefined && (material === null || LENS_MATERIALS.includes(material))) {
      entry.material = material;
    }
    if (coating !== undefined) entry.coating = coating ? String(coating).trim() : null;
    if (color !== undefined && (color === null || LENS_COLORS.includes(color))) {
      entry.color = color;
    }
    if (eye !== undefined && EYE_VALUES.includes(eye)) entry.eye = eye;
    if (sph !== undefined) entry.sph = sph === null || sph === '' ? null : Number(sph);
    if (cyl !== undefined) entry.cyl = cyl === null || cyl === '' ? 0 : Number(cyl);
    if (add !== undefined) entry.add = add === null || add === '' ? null : Number(add);

    await entry.save();
    invalidateInvoiceLookupCache();

    // If unitCost was updated and complete SKU is known, update LensStock lastCost
    if (entry.unitCost !== null && entry.lensType && entry.material && entry.coating && entry.color && entry.sph !== null) {
      await LensStock.findOneAndUpdate(
        {
          lensType: entry.lensType,
          material: entry.material,
          coating: entry.coating,
          color: entry.color,
          sph: entry.sph,
          cyl: typeof entry.cyl === 'number' ? entry.cyl : 0,
          add: typeof entry.add === 'number' ? entry.add : null,
        },
        {
          $set: { lastCost: entry.unitCost },
          $setOnInsert: { reorderLevel: 2, costPrice: entry.unitCost },
        },
        { upsert: true, new: true, runValidators: false },
      );
    }

    // Handle updateMasterPricing
    if (updateMasterPricing && entry.unitCost !== null && entry.unitCost > 0) {
      try {
        if (entry.lensPricingId) {
          const rule = await LensPricing.findById(entry.lensPricingId);
          if (rule) {
            rule.costPrice = entry.unitCost;
            if (entry.unitSellPrice) rule.price = entry.unitSellPrice;
            await rule.save();
          }
        } else if (entry.lensType && entry.material && entry.coating && entry.sph !== null) {
          await LensPricing.create({
            lensType: entry.lensType,
            material: entry.material,
            coating: entry.coating,
            color: entry.color || 'White',
            axisType: 'any',
            minSph: entry.sph,
            maxSph: entry.sph,
            minCyl: entry.cyl || 0,
            maxCyl: entry.cyl || 0,
            minAdd: entry.add,
            maxAdd: entry.add,
            costPrice: entry.unitCost,
            price: entry.unitSellPrice || Math.round(entry.unitCost * 2.5),
            brand: entry.brand || undefined,
          });
        }
      } catch (e) {
        console.error('[updatePurchaseEntry] Master pricing update failed:', e);
      }
    }

    res.json({ message: 'Purchase entry updated successfully', entry });
  } catch (error) {
    next(error);
  }
};

// ── DELETE /api/purchases/:id — delete entry or multiple entries by ID ──
export const deletePurchaseEntry = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id } = req.params;
    const { entryIds } = req.query;

    const idsToDelete = entryIds
      ? String(entryIds).split(',').map((s) => s.trim()).filter(Boolean)
      : [id];

    for (const eid of idsToDelete) {
      await PurchaseEntry.findByIdAndDelete(eid);
    }

    res.json({ message: `Deleted ${idsToDelete.length} purchase entry record(s) successfully.` });
  } catch (error) {
    next(error);
  }
};

// ── POST /api/purchases/clear-all — purge all procurement ledger records so user can start fresh ──
export const clearAllPurchases = async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const db = getDb();
    const snap = await db.collection('purchaseentries').get();
    const docs = snap.docs;
    for (let i = 0; i < docs.length; i += 400) {
      const batch = db.batch();
      const chunk = docs.slice(i, i + 400);
      chunk.forEach(d => batch.delete(d.ref));
      await batch.commit();
    }
    invalidateInvoiceLookupCache();
    res.json({ message: `Purged ${docs.length} procurement ledger entries successfully.` });
  } catch (error) {
    next(error);
  }
};

// ── GET /api/purchases/legacy-summary — list unmapped raw descriptions with occurrence counts ──
export const getLegacySummary = async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const all = await PurchaseEntry.find({
      $or: [
        { unitCost: null },
        { lensType: null },
        { rawDescription: { $ne: null } },
        { notes: { $ne: null } },
      ],
    }).lean();

    // Helper to extract shorthand hints
    function inferSpecs(text: string) {
      const lower = text.toLowerCase();
      const lensType = lower.includes('prog') ? 'Progressive' : (lower.includes('bi') || lower.includes('kt')) ? 'Bifocal' : 'Single Vision';
      const material = (lower.includes('poly') || lower.includes('pc')) ? 'Polycarbonate' : lower.includes('glass') ? 'Glass' : 'Fiber';
      const coating = (lower.includes('blue') || lower.includes('bb')) ? 'Blue Block' : (lower.includes('hc') || lower.includes('hard')) ? 'Hard Coat' : 'Anti-Reflective';
      const color = (lower.includes('photo') || lower.includes('pg') || lower.includes('pb') || lower.includes('brown')) ? 'Photo Chromatic' : 'White';
      return { lensType, material, coating, color };
    }

    const map = new Map<string, { rawText: string; count: number; sampleDate: Date; suggested: ReturnType<typeof inferSpecs> }>();

    for (const item of all) {
      const raw = (item.rawDescription || item.notes || '').trim();
      if (!raw || raw.startsWith('Patient:') || raw.startsWith('Prescription:') || raw.length < 2) continue;

      if (!map.has(raw)) {
        map.set(raw, {
          rawText: raw,
          count: 1,
          sampleDate: item.purchaseDate || (item as any).createdAt,
          suggested: inferSpecs(raw),
        });
      } else {
        const cur = map.get(raw)!;
        cur.count++;
      }
    }

    const groups = Array.from(map.values()).sort((a, b) => b.count - a.count);
    res.json({ totalUnmappedGroups: groups.length, groups });
  } catch (error) {
    next(error);
  }
};

// ── POST /api/purchases/map-legacy — batch map legacy raw text to structured specs ──
export const mapLegacyEntries = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { rawText, mapping, updateInvoiceItems = true } = req.body;
    if (!rawText || typeof rawText !== 'string' || !mapping) {
      res.status(400).json({ message: 'rawText and mapping object are required.' });
      return;
    }

    const { lensType, material, coating, color = 'White', brand, unitCost, unitSellPrice } = mapping;

    const query = {
      $or: [
        { rawDescription: rawText },
        { notes: rawText },
      ],
    };

    const entries = await PurchaseEntry.find(query);
    let updatedPurchasesCount = 0;

    for (const entry of entries) {
      entry.rawDescription = entry.rawDescription || rawText;
      entry.lensType = lensType;
      entry.material = material;
      entry.coating = coating;
      entry.color = color;
      if (brand) entry.brand = brand;
      if (unitCost !== undefined && unitCost !== null) {
        entry.unitCost = Number(unitCost);
        entry.costPerPair = Math.round(Number(unitCost) * 2 * 100) / 100;
      }
      if (unitSellPrice !== undefined && unitSellPrice !== null) {
        entry.unitSellPrice = Number(unitSellPrice);
      }
      entry.normalizedLens = {
        type: lensType,
        material,
        coating,
        brand: brand || null,
      };

      await entry.save();
      updatedPurchasesCount++;
    }

    let updatedInvoiceItemsCount = 0;
    if (updateInvoiceItems) {
      const invoiceItems = await InvoiceItem.find({
        $or: [
          { lensType: rawText },
          { lensLabel: rawText },
          { lensCategory: rawText },
        ],
      });

      for (const item of invoiceItems) {
        (item as any).normalizedLens = {
          type: lensType,
          material,
          coating,
          brand: brand || null,
        };
        await item.save();
        updatedInvoiceItemsCount++;
      }
    }

    res.json({
      message: `Mapped "${rawText}" successfully across ${updatedPurchasesCount} purchase records and ${updatedInvoiceItemsCount} invoice items.`,
      updatedPurchasesCount,
      updatedInvoiceItemsCount,
    });
  } catch (error) {
    next(error);
  }
};

// ── POST /api/purchases/populate-all — cleanly populate from customer lens sales & lab orders ──

function parseEyeNumberString(eyeStr: string | null | undefined, isBifocalOrProg: boolean) {
  if (!eyeStr || !eyeStr.trim()) return { sph: null, cyl: null, axis: null, add: null };
  const parts = eyeStr.split('/').map(s => s.trim());

  let sph: number | null = null;
  let cyl: number | null = null;
  let axis: number | null = null;
  let add: number | null = null;

  for (const part of parts) {
    if (part.toLowerCase().startsWith('x')) {
      const axNum = parseFloat(part.slice(1).trim());
      if (!isNaN(axNum)) axis = axNum;
    } else {
      const val = parseFloat(part);
      if (!isNaN(val)) {
        if (sph === null) {
          sph = val;
        } else if (isBifocalOrProg && add === null && val > 0 && !part.includes('cyl')) {
          add = val;
        } else if (cyl === null) {
          cyl = val;
        } else if (add === null) {
          add = val;
        }
      }
    }
  }

  return { sph, cyl, axis, add };
}

export const populateAllLensSources = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const shouldClear = req.query.resync === 'true' || req.body?.clearExisting === true;
    const db = getDb();

    if (shouldClear) {
      const existingSnap = await db.collection('purchaseentries').get();
      const docs = existingSnap.docs;
      for (let i = 0; i < docs.length; i += 400) {
        const batch = db.batch();
        const chunk = docs.slice(i, i + 400);
        chunk.forEach(d => batch.delete(d.ref));
        await batch.commit();
      }
    }

    const alreadyImported = new Set(
      shouldClear ? [] : (await PurchaseEntry.distinct('importedFrom', { importedFrom: { $ne: null } })).map(String)
    );

    const [invoices, items, customers] = await Promise.all([
      Invoice.find({}).lean(),
      InvoiceItem.find({}).lean(),
      Customer.find({}).lean(),
    ]);

    const customerMap = new Map<string, string>();
    for (const c of customers) {
      const cid = String(c._id);
      customerMap.set(cid, c.name || 'Walk-in Client');
    }

    const invById = new Map<string, any>();
    const invByItemId = new Map<string, any>();
    const invByNumber = new Map<string, any>();

    for (const inv of invoices) {
      const invId = String(inv._id);
      invById.set(invId, inv);
      if (inv.invoiceNumber) {
        invByNumber.set(inv.invoiceNumber.toLowerCase().trim(), inv);
      }
      if (Array.isArray(inv.items)) {
        for (const itId of inv.items) {
          invByItemId.set(String(itId), inv);
        }
      }
    }

    // Filter STRICTLY true lenses - strictly exclude fragrances and frames
    const lensItems = items.filter(it => {
      if (it.fragrance || it.type === 'fragrance' || (it.quantity === 0.25 && !it.lensType)) return false;
      if (it.frame || it.type === 'frame') return false;
      const hasRx = (
        (it.spherical !== undefined && it.spherical !== null) ||
        (it.rightSpherical !== undefined && it.rightSpherical !== null) ||
        (it.leftSpherical !== undefined && it.leftSpherical !== null) ||
        (it.cylinder !== undefined && it.cylinder !== null) ||
        (it.rightCylinder !== undefined && it.rightCylinder !== null) ||
        (it.leftCylinder !== undefined && it.leftCylinder !== null) ||
        Boolean(it.rightEyeNumber || it.leftEyeNumber)
      );
      const isLens = Boolean(
        it.type === 'opticalLens' ||
        it.opticalLens ||
        it.isCustomLens ||
        it.lensType ||
        it.lensMaterial ||
        it.lensCoating ||
        it.lensCategory
      );
      return hasRx || isLens;
    });

    let createdCount = 0;
    let skippedCount = 0;
    const entriesToBatch: any[] = [];

    for (const item of lensItems) {
      const itId = String(item._id);
      if (alreadyImported.has(itId) || alreadyImported.has(`${itId}_re`) || alreadyImported.has(`${itId}_le`)) {
        skippedCount++;
        continue;
      }

      // Resolve Invoice
      let inv = invByItemId.get(itId);
      if (!inv && item.invoice) inv = invById.get(String(item.invoice));
      if (!inv && item.invoiceId) inv = invById.get(String(item.invoiceId));
      if (!inv && item.invoiceNumber) inv = invByNumber.get(String(item.invoiceNumber).toLowerCase().trim());

      const invNumber = inv?.invoiceNumber || (item.invoiceNumber ? String(item.invoiceNumber) : null);
      const invId = inv ? String(inv._id) : null;
      const customerName = inv?.customer
        ? (customerMap.get(String(inv.customer)) || 'Customer')
        : (item.userName || item.lensLabel || 'Walk-in Client');

      // Resolve 4 Lens Specs
      const rawType = `${item.lensType || item.lensCategory || ''}`.toLowerCase();
      const rawMat = `${item.lensMaterial || ''}`.toLowerCase();
      const rawCol = `${item.lensColor || ''}`.toLowerCase();
      const rawCoat = `${item.lensCoating || ''}`.toLowerCase();

      const lensType = rawType.includes('prog')
        ? 'Progressive'
        : (rawType.includes('bi') || rawType.includes('kt') || rawType.includes('kryptok'))
        ? 'Bifocal'
        : 'Single Vision';

      const material = rawMat.includes('poly') || rawMat.includes('pc')
        ? 'Polycarbonate'
        : rawMat.includes('glass')
        ? 'Glass'
        : 'Fiber';

      const color = (rawCol.includes('photo') || rawCol.includes('pg') || rawCol.includes('pb') || rawCoat.includes('photo'))
        ? 'Photo Chromatic'
        : rawCol.includes('polar')
        ? 'Polarized'
        : rawCol.includes('tint')
        ? 'Tinted'
        : 'White';

      let coating = (item.lensCoating && item.lensCoating.trim()) || '';
      if (!coating) {
        if (rawCoat.includes('blue') || rawCoat.includes('bb') || rawCoat.includes('blue cut')) {
          coating = 'Blue Block';
        } else if (rawCoat.includes('hc') || rawCoat.includes('hard')) {
          coating = 'Hard Coat';
        } else {
          coating = 'Anti-Reflective';
        }
      }

      const brand = item.lensBrand || item.lensCompany || null;
      const purchaseDate = inv?.billDate || (inv as any)?.createdAt || item.createdAt || new Date();
      const wholesalerOrderDate = item.wholesalerOrderDate ?? null;
      const sellPrice = typeof item.price === 'number' && item.price > 0 ? item.price : null;
      const costPerPair = typeof item.costPrice === 'number' && item.costPrice > 0 ? item.costPrice : null;
      const entryStatus: 'pending' | 'received' = costPerPair !== null && costPerPair > 0 ? 'received' : 'pending';

      const isBifocalOrProg = lensType === 'Bifocal' || lensType === 'Progressive';

      const reParsed = parseEyeNumberString(item.rightEyeNumber, isBifocalOrProg);
      const leParsed = parseEyeNumberString(item.leftEyeNumber, isBifocalOrProg);

      const hasExplicitRE = (item.rightSpherical !== undefined && item.rightSpherical !== null) ||
                            (item.rightCylinder !== undefined && item.rightCylinder !== null) ||
                            reParsed.sph !== null ||
                            Boolean(item.rightEyeNumber);

      const hasExplicitLE = (item.leftSpherical !== undefined && item.leftSpherical !== null) ||
                            (item.leftCylinder !== undefined && item.leftCylinder !== null) ||
                            leParsed.sph !== null ||
                            Boolean(item.leftEyeNumber);

      // Check if this item represents a pair (both eyes, isSameNumber, or quantity pair)
      const isPair = (hasExplicitRE && hasExplicitLE) ||
                     item.isSameNumber === true ||
                     item.eye === 'both' ||
                     (item.eye !== 'left' && item.eye !== 'right' && (item.quantity === 1 || item.quantity === 2));

      if (isPair) {
        // Dual-eye item (pair of lenses)
        const reSph = item.rightSpherical ?? reParsed.sph ?? item.spherical ?? 0;
        const reCyl = item.rightCylinder ?? reParsed.cyl ?? item.cylinder ?? 0;
        const reAdd = item.rightAddition ?? reParsed.add ?? item.addition ?? null;

        const leSph = item.leftSpherical ?? leParsed.sph ?? item.spherical ?? 0;
        const leCyl = item.leftCylinder ?? leParsed.cyl ?? item.cylinder ?? 0;
        const leAdd = item.leftAddition ?? leParsed.add ?? item.addition ?? null;

        entriesToBatch.push({
          status: entryStatus,
          lensType,
          material,
          coating,
          color,
          brand,
          eye: 'right',
          sph: typeof reSph === 'number' ? reSph : 0,
          cyl: typeof reCyl === 'number' ? reCyl : 0,
          add: reAdd,
          qty: 1,
          unitCost: costPerPair !== null ? Math.round((costPerPair / 2) * 100) / 100 : null,
          costPerPair,
          unitSellPrice: sellPrice,
          supplier: 'Wholesale Lab',
          supplierInvoiceRef: invNumber,
          purchaseInvoiceId: invId,
          notes: `${customerName} (RE)`,
          purchaseDate,
          wholesalerOrderDate,
          importedFrom: `${itId}_re`,
          createdAt: purchaseDate,
          updatedAt: new Date(),
        });
        alreadyImported.add(`${itId}_re`);
        createdCount++;

        entriesToBatch.push({
          status: entryStatus,
          lensType,
          material,
          coating,
          color,
          brand,
          eye: 'left',
          sph: typeof leSph === 'number' ? leSph : 0,
          cyl: typeof leCyl === 'number' ? leCyl : 0,
          add: leAdd,
          qty: 1,
          unitCost: costPerPair !== null ? Math.round((costPerPair / 2) * 100) / 100 : null,
          costPerPair,
          unitSellPrice: sellPrice,
          supplier: 'Wholesale Lab',
          supplierInvoiceRef: invNumber,
          purchaseInvoiceId: invId,
          notes: `${customerName} (LE)`,
          purchaseDate,
          wholesalerOrderDate,
          importedFrom: `${itId}_le`,
          createdAt: purchaseDate,
          updatedAt: new Date(),
        });
        alreadyImported.add(`${itId}_le`);
        createdCount++;
      } else {
        const eye = item.eye === 'left' ? 'left' : item.eye === 'right' ? 'right' : (hasExplicitLE ? 'left' : hasExplicitRE ? 'right' : 'both');
        const parsed = eye === 'left' ? leParsed : reParsed;
        const sph = (eye === 'left'
          ? (item.leftSpherical ?? parsed.sph ?? item.spherical)
          : (item.rightSpherical ?? parsed.sph ?? item.spherical)) ?? item.spherical ?? 0;
        const cyl = (eye === 'left' ? (item.leftCylinder ?? parsed.cyl ?? item.cylinder) : (item.rightCylinder ?? parsed.cyl ?? item.cylinder)) ?? item.cylinder ?? 0;
        const add = (eye === 'left' ? (item.leftAddition ?? parsed.add ?? item.addition) : (item.rightAddition ?? parsed.add ?? item.addition)) ?? item.addition ?? null;

        const importedKey = item.prescription && (eye === 'right' || eye === 'left')
          ? `rx_${item.prescription}_${eye === 'right' ? 're' : 'le'}`
          : itId;

        entriesToBatch.push({
          status: entryStatus,
          lensType,
          material,
          coating,
          color,
          brand,
          eye,
          sph: typeof sph === 'number' ? sph : 0,
          cyl: typeof cyl === 'number' ? cyl : 0,
          add,
          qty: item.quantity || 1,
          unitCost: costPerPair !== null ? costPerPair : null,
          costPerPair,
          unitSellPrice: sellPrice,
          supplier: 'Wholesale Lab',
          supplierInvoiceRef: invNumber,
          purchaseInvoiceId: invId,
          notes: `${customerName}${eye !== 'both' ? ` (${eye === 'right' ? 'RE' : 'LE'})` : ''}`,
          purchaseDate,
          wholesalerOrderDate,
          importedFrom: importedKey,
          createdAt: purchaseDate,
          updatedAt: new Date(),
        });
        alreadyImported.add(importedKey);
        createdCount++;
      }
    }

    // Insert in batches of 400
    const purchaseCol = db.collection('purchaseentries');
    for (let i = 0; i < entriesToBatch.length; i += 400) {
      const batch = db.batch();
      const chunk = entriesToBatch.slice(i, i + 400);
      for (const entry of chunk) {
        const docRef = purchaseCol.doc();
        batch.set(docRef, { ...entry, id: docRef.id, _id: docRef.id });
      }
      await batch.commit();
    }

    invalidateInvoiceLookupCache();
    const totalCount = await PurchaseEntry.countDocuments({});

    res.json({
      message: `Cleanly synced ${createdCount} lens entries from past invoices.`,
      createdCount,
      skippedCount,
      totalCount,
    });
  } catch (error) {
    next(error);
  }
};

// ── Invoice Lookup Cache & Relative Invoice Enrichment ─────────────────────────

let invoiceLookupCache: {
  expiresAt: number;
  invoicesByNumber: Map<string, any>;
  invoicesById: Map<string, any>;
  invoicesByItemId: Map<string, any>;
  customerMap: Map<string, string>;
  invoiceItemsMap: Map<string, any>;
} | null = null;

export function invalidateInvoiceLookupCache(): void {
  invoiceLookupCache = null;
}

async function getInvoiceLookupCache() {
  const now = Date.now();
  if (invoiceLookupCache && invoiceLookupCache.expiresAt > now) {
    return invoiceLookupCache;
  }

  const [invoices, customers, invoiceItems] = await Promise.all([
    Invoice.find({}).lean(),
    Customer.find({}).lean(),
    InvoiceItem.find({}).lean(),
  ]);

  const customerMap = new Map<string, string>();
  for (const c of customers) {
    const cid = String(c._id || c.id);
    if (cid) customerMap.set(cid, c.name || 'Customer');
  }

  const invoiceItemsMap = new Map<string, any>();
  for (const it of invoiceItems) {
    const itId = String(it._id || it.id);
    if (itId) invoiceItemsMap.set(itId, it);
  }

  const invoicesByNumber = new Map<string, any>();
  const invoicesById = new Map<string, any>();
  const invoicesByItemId = new Map<string, any>();

  for (const inv of invoices) {
    const invId = String(inv._id || inv.id);
    const invNum = inv.invoiceNumber || `INV-${invId.slice(-6)}`;
    const custId = inv.customer ? String(inv.customer) : '';
    const customerName = customerMap.get(custId) || 'Customer';

    const resolvedItems = Array.isArray(inv.items)
      ? inv.items
          .map((itId: any) => {
            const it = invoiceItemsMap.get(String(itId));
            if (!it) return null;
            return {
              id: String(itId),
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
          .filter(Boolean)
      : [];

    const invData = {
      id: invId,
      invoiceNumber: invNum,
      customerName,
      billDate: inv.billDate || inv.createdAt,
      total: inv.total,
      items: resolvedItems,
    };

    invoicesById.set(invId, invData);
    invoicesByNumber.set(invNum.toLowerCase().trim(), invData);
    const cleanNum = invNum.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
    if (cleanNum) invoicesByNumber.set(cleanNum, invData);

    if (Array.isArray(inv.items)) {
      for (const itId of inv.items) {
        invoicesByItemId.set(String(itId), invData);
      }
    }
  }

  invoiceLookupCache = {
    expiresAt: now + 3 * 60 * 1000,
    invoicesByNumber,
    invoicesById,
    invoicesByItemId,
    customerMap,
    invoiceItemsMap,
  };

  return invoiceLookupCache;
}

// ── Auto-create Pending Purchases on Invoice Creation ─────────────────────────

export async function createPendingPurchasesForInvoice(invoiceId: string | any): Promise<number> {
  try {
    const inv = await Invoice.findById(invoiceId).populate('customer items');
    if (!inv || !Array.isArray(inv.items) || inv.items.length === 0) return 0;

    invalidateInvoiceLookupCache();

    const customerName = inv.customer?.name || 'Walk-in Client';
    const invNumber = inv.invoiceNumber || null;
    const invId = String(inv._id || inv.id);
    const purchaseDate = inv.billDate || (inv as any).createdAt || new Date();

    let createdCount = 0;

    for (const item of inv.items) {
      if (!item) continue;
      // Skip fragrances and frames without lenses
      if (item.fragrance || item.type === 'fragrance' || (item.quantity === 0.25 && !item.lensType)) continue;
      if (item.frame && item.type === 'frame') continue;

      const hasRx = (
        (item.spherical !== undefined && item.spherical !== null) ||
        (item.rightSpherical !== undefined && item.rightSpherical !== null) ||
        (item.leftSpherical !== undefined && item.leftSpherical !== null) ||
        (item.cylinder !== undefined && item.cylinder !== null) ||
        (item.rightCylinder !== undefined && item.rightCylinder !== null) ||
        (item.leftCylinder !== undefined && item.leftCylinder !== null) ||
        Boolean(item.rightEyeNumber || item.leftEyeNumber)
      );

      const isLens = Boolean(
        item.type === 'opticalLens' ||
        item.opticalLens ||
        item.isCustomLens ||
        item.lensType ||
        item.lensMaterial ||
        item.lensCoating ||
        item.lensCategory ||
        hasRx
      );

      if (!isLens) continue;

      const itId = String(item._id || item.id);

      // Check if already created
      const existing = await PurchaseEntry.findOne({
        $or: [
          { importedFrom: itId },
          { importedFrom: `${itId}_re` },
          { importedFrom: `${itId}_le` },
        ],
      });
      if (existing) continue;

      // Resolve 4 Lens Specs
      const rawType = `${item.lensType || item.lensCategory || ''}`.toLowerCase();
      const rawMat = `${item.lensMaterial || ''}`.toLowerCase();
      const rawCol = `${item.lensColor || ''}`.toLowerCase();
      const rawCoat = `${item.lensCoating || ''}`.toLowerCase();

      const lensType = rawType.includes('prog')
        ? 'Progressive'
        : (rawType.includes('bi') || rawType.includes('kt') || rawType.includes('kryptok'))
        ? 'Bifocal'
        : 'Single Vision';

      const material = rawMat.includes('poly') || rawMat.includes('pc')
        ? 'Polycarbonate'
        : rawMat.includes('glass')
        ? 'Glass'
        : 'Fiber';

      const color = (rawCol.includes('photo') || rawCol.includes('pg') || rawCol.includes('pb') || rawCoat.includes('photo'))
        ? 'Photo Chromatic'
        : rawCol.includes('polar')
        ? 'Polarized'
        : rawCol.includes('tint')
        ? 'Tinted'
        : 'White';

      let coating = (item.lensCoating && item.lensCoating.trim()) || '';
      if (!coating) {
        if (rawCoat.includes('blue') || rawCoat.includes('bb') || rawCoat.includes('blue cut')) {
          coating = 'Blue Block';
        } else if (rawCoat.includes('hc') || rawCoat.includes('hard')) {
          coating = 'Hard Coat';
        } else {
          coating = 'Anti-Reflective';
        }
      }

      const brand = item.lensBrand || item.lensCompany || null;
      const sellPrice = typeof item.price === 'number' && item.price > 0 ? item.price : null;
      const isBifocalOrProg = lensType === 'Bifocal' || lensType === 'Progressive';

      const reParsed = parseEyeNumberString(item.rightEyeNumber, isBifocalOrProg);
      const leParsed = parseEyeNumberString(item.leftEyeNumber, isBifocalOrProg);

      const hasExplicitRE = (item.rightSpherical !== undefined && item.rightSpherical !== null) ||
                            (item.rightCylinder !== undefined && item.rightCylinder !== null) ||
                            reParsed.sph !== null ||
                            Boolean(item.rightEyeNumber);

      const hasExplicitLE = (item.leftSpherical !== undefined && item.leftSpherical !== null) ||
                            (item.leftCylinder !== undefined && item.leftCylinder !== null) ||
                            leParsed.sph !== null ||
                            Boolean(item.leftEyeNumber);

      const isPair = (hasExplicitRE && hasExplicitLE) ||
                     item.isSameNumber === true ||
                     item.eye === 'both' ||
                     (item.eye !== 'left' && item.eye !== 'right' && (item.quantity === 1 || item.quantity === 2));

      if (isPair) {
        const reSph = item.rightSpherical ?? reParsed.sph ?? item.spherical ?? 0;
        const reCyl = item.rightCylinder ?? reParsed.cyl ?? item.cylinder ?? 0;
        const reAdd = item.rightAddition ?? reParsed.add ?? item.addition ?? null;

        const leSph = item.leftSpherical ?? leParsed.sph ?? item.spherical ?? 0;
        const leCyl = item.leftCylinder ?? leParsed.cyl ?? item.cylinder ?? 0;
        const leAdd = item.leftAddition ?? leParsed.add ?? item.addition ?? null;

        await PurchaseEntry.create({
          status: 'pending',
          lensType,
          material,
          coating,
          color,
          brand,
          eye: 'right',
          sph: typeof reSph === 'number' ? reSph : 0,
          cyl: typeof reCyl === 'number' ? reCyl : 0,
          add: reAdd,
          qty: 1,
          unitCost: null,
          costPerPair: null,
          unitSellPrice: sellPrice,
          supplier: 'Wholesale Lab',
          supplierInvoiceRef: invNumber,
          purchaseInvoiceId: invId,
          notes: `${customerName} (RE)`,
          purchaseDate,
          importedFrom: `${itId}_re`,
        });

        await PurchaseEntry.create({
          status: 'pending',
          lensType,
          material,
          coating,
          color,
          brand,
          eye: 'left',
          sph: typeof leSph === 'number' ? leSph : 0,
          cyl: typeof leCyl === 'number' ? leCyl : 0,
          add: leAdd,
          qty: 1,
          unitCost: null,
          costPerPair: null,
          unitSellPrice: sellPrice,
          supplier: 'Wholesale Lab',
          supplierInvoiceRef: invNumber,
          purchaseInvoiceId: invId,
          notes: `${customerName} (LE)`,
          purchaseDate,
          importedFrom: `${itId}_le`,
        });

        createdCount += 2;
      } else {
        const eye = item.eye === 'left' ? 'left' : item.eye === 'right' ? 'right' : (hasExplicitLE ? 'left' : hasExplicitRE ? 'right' : 'both');
        const parsed = eye === 'left' ? leParsed : reParsed;
        const sph = (eye === 'left'
          ? (item.leftSpherical ?? parsed.sph ?? item.spherical)
          : (item.rightSpherical ?? parsed.sph ?? item.spherical)) ?? item.spherical ?? 0;
        const cyl = (eye === 'left' ? (item.leftCylinder ?? parsed.cyl ?? item.cylinder) : (item.rightCylinder ?? parsed.cyl ?? item.cylinder)) ?? item.cylinder ?? 0;
        const add = (eye === 'left' ? (item.leftAddition ?? parsed.add ?? item.addition) : (item.rightAddition ?? parsed.add ?? item.addition)) ?? item.addition ?? null;

        await PurchaseEntry.create({
          status: 'pending',
          lensType,
          material,
          coating,
          color,
          brand,
          eye,
          sph: typeof sph === 'number' ? sph : 0,
          cyl: typeof cyl === 'number' ? cyl : 0,
          add,
          qty: item.quantity || 1,
          unitCost: null,
          costPerPair: null,
          unitSellPrice: sellPrice,
          supplier: 'Wholesale Lab',
          supplierInvoiceRef: invNumber,
          purchaseInvoiceId: invId,
          notes: `${customerName}${eye !== 'both' ? ` (${eye === 'right' ? 'RE' : 'LE'})` : ''}`,
          purchaseDate,
          importedFrom: itId,
        });

        createdCount++;
      }
    }

    return createdCount;
  } catch (err) {
    console.error('[createPendingPurchasesForInvoice] Error creating pending entries:', err);
    return 0;
  }
}

// ── In-Memory Fast Match for Master Lens Pricing Matrix ───────────────────────

function matchPricingRuleFast(allRules: any[], lens: {
  lensType?: string | null;
  material?: string | null;
  coating?: string | null;
  color?: string | null;
  brand?: string | null;
  sph?: number | null;
  cyl?: number | null;
  add?: number | null;
}): any | null {
  const lensType = (lens.lensType || 'Single Vision').toLowerCase().trim();
  const material = (lens.material || 'Fiber').toLowerCase().trim();
  const coating = (lens.coating || '').toLowerCase().trim();
  const sph = typeof lens.sph === 'number' ? lens.sph : 0;
  const cyl = typeof lens.cyl === 'number' ? lens.cyl : 0;
  const addVal = typeof lens.add === 'number' ? lens.add : null;

  let bestRule: any = null;
  let bestScore = -1;

  for (const rule of allRules) {
    const rType = (rule.lensType || '').toLowerCase().trim();
    const rMat = (rule.material || '').toLowerCase().trim();

    // Type and material must match
    if (rType && rType !== lensType) continue;
    if (rMat && rMat !== material) continue;

    // SPH bracket
    const minS = Math.min(rule.minSph ?? -20, rule.maxSph ?? 20);
    const maxS = Math.max(rule.minSph ?? -20, rule.maxSph ?? 20);
    if (sph < minS - 0.001 || sph > maxS + 0.001) continue;

    // CYL bracket
    const minC = Math.min(rule.minCyl ?? -10, rule.maxCyl ?? 10);
    const maxC = Math.max(rule.minCyl ?? -10, rule.maxCyl ?? 10);
    if (cyl < minC - 0.001 || cyl > maxC + 0.001) continue;

    // ADD bracket
    if (addVal !== null && rule.minAdd !== null && rule.minAdd !== undefined) {
      const minA = rule.minAdd;
      const maxA = rule.maxAdd ?? minA;
      if (addVal < minA - 0.001 || addVal > maxA + 0.001) continue;
    }

    let score = 0;
    // Coating match
    if (coating && rule.coating) {
      const rCoat = rule.coating.toLowerCase().trim();
      if (rCoat === coating) score += 50;
      else if (rCoat.includes(coating) || coating.includes(rCoat)) score += 30;
    }

    // Narrower bracket bonus
    const span = Math.abs(maxS - minS) + Math.abs(maxC - minC);
    score += Math.max(0, 20 - span);

    if (score > bestScore) {
      bestScore = score;
      bestRule = rule;
    }
  }

  return bestRule;
}

export async function enrichPurchaseEntriesWithInvoices(entries: any[]): Promise<any[]> {
  try {
    const [cache, allPricingRules] = await Promise.all([
      getInvoiceLookupCache(),
      LensPricing.find({}).lean(),
    ]);

    return entries.map((entry) => {
      let matchedInv: any = null;
      let matchedItem: any = null;

      // 1. Match by supplierInvoiceRef
      if (entry.supplierInvoiceRef) {
        const ref = String(entry.supplierInvoiceRef).trim();
        matchedInv =
          cache.invoicesByNumber.get(ref.toLowerCase()) ||
          cache.invoicesByNumber.get(ref.replace(/[^a-zA-Z0-9]/g, '').toLowerCase()) ||
          cache.invoicesById.get(ref);
      }

      // 2. Match by purchaseInvoiceId
      if (!matchedInv && entry.purchaseInvoiceId) {
        const pid = String(entry.purchaseInvoiceId).trim();
        matchedInv = cache.invoicesById.get(pid) || cache.invoicesByNumber.get(pid.toLowerCase());
      }

      // 3. Match by importedFrom (contains invoiceItemId)
      if (!matchedInv && entry.importedFrom) {
        const cleanId = String(entry.importedFrom).replace(/_(re|le)$/, '').replace(/^rx_/, '').trim();
        matchedInv = cache.invoicesByItemId.get(cleanId);
        matchedItem = cache.invoiceItemsMap.get(cleanId);
      }

      let resolvedSph = entry.sph;
      let resolvedCyl = entry.cyl;
      let resolvedAdd = entry.add;
      let resolvedSellPrice = entry.unitSellPrice ?? null;
      let relativeInvoice: any = null;

      if (matchedInv) {
        if (!matchedItem && matchedInv.items && matchedInv.items.length > 0) {
          const lensItems = matchedInv.items.filter((it: any) => it.type === 'lens' || it.lensType || it.lensCoating || it.lensLabel);
          matchedItem =
            (lensItems.length > 0 ? lensItems : matchedInv.items).find((it: any) => {
              if (entry.notes && it.lensLabel && it.lensLabel.toLowerCase().includes(entry.notes.toLowerCase())) return true;
              if (entry.notes && it.userName && it.userName.toLowerCase().includes(entry.notes.toLowerCase())) return true;
              if (entry.coating && it.lensCoating && it.lensCoating.toLowerCase() === entry.coating.toLowerCase()) return true;
              return false;
            }) || (lensItems[0] || matchedInv.items[0]);
        }

        if (matchedItem) {
          const itSph = entry.eye === 'left' ? (matchedItem.lSph ?? matchedItem.sph) : (matchedItem.rSph ?? matchedItem.sph);
          const itCyl = entry.eye === 'left' ? (matchedItem.lCyl ?? matchedItem.cyl) : (matchedItem.rCyl ?? matchedItem.cyl);
          const itAdd = entry.eye === 'left' ? (matchedItem.lAdd ?? matchedItem.add) : (matchedItem.rAdd ?? matchedItem.add);

          if ((resolvedSph === null || resolvedSph === undefined) && itSph !== null && itSph !== undefined) {
            resolvedSph = itSph;
          }
          if ((resolvedCyl === null || resolvedCyl === undefined || resolvedCyl === 0) && itCyl !== null && itCyl !== undefined && itCyl !== 0) {
            resolvedCyl = itCyl;
          }
          if ((resolvedAdd === null || resolvedAdd === undefined) && itAdd !== null && itAdd !== undefined && itAdd !== 0) {
            resolvedAdd = itAdd;
          }
        }

        const lensDesc = matchedItem
          ? [matchedItem.lensType, matchedItem.lensMaterial, matchedItem.lensCoating, matchedItem.lensColor || 'White'].filter(Boolean).join(' · ')
          : undefined;
        const patientName = matchedItem?.userName || matchedItem?.lensLabel || undefined;
        const invoiceItemPrice = typeof matchedItem?.price === 'number' && matchedItem.price > 0 ? matchedItem.price : undefined;
        resolvedSellPrice = entry.unitSellPrice ?? invoiceItemPrice ?? null;

        relativeInvoice = {
          id: matchedInv.id,
          invoiceNumber: matchedInv.invoiceNumber,
          customerName: matchedInv.customerName,
          patientName,
          lensDescription: lensDesc,
          billDate: matchedInv.billDate,
          total: matchedInv.total,
          items: matchedInv.items,
          matchedItem: matchedItem ? {
            id: matchedItem.id,
            price: matchedItem.price,
            lensType: matchedItem.lensType,
            lensMaterial: matchedItem.lensMaterial,
            lensCoating: matchedItem.lensCoating,
            lensColor: matchedItem.lensColor,
          } : undefined,
        };
      }

      // Fast in-memory match against Master Matrix
      const matchedRule = matchPricingRuleFast(allPricingRules, {
        lensType: entry.lensType,
        material: entry.material,
        coating: entry.coating,
        color: entry.color,
        brand: entry.brand,
        sph: resolvedSph,
        cyl: resolvedCyl,
        add: resolvedAdd,
      });

      return {
        ...entry,
        sph: resolvedSph,
        cyl: resolvedCyl,
        add: resolvedAdd,
        unitSellPrice: resolvedSellPrice,
        relativeInvoice,
        expectedCost: matchedRule?.costPrice ?? null,
        expectedSell: matchedRule?.price ?? null,
        pricingId: matchedRule ? String(matchedRule._id || matchedRule.id) : null,
      };
    });
  } catch (err) {
    console.error('[enrichPurchaseEntriesWithInvoices] Error:', err);
    return entries;
  }
}

// ── GET /api/purchases — history with optional filters ────────────────────────

export const getPurchaseHistory = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const {
      from,
      to,
      lensType,
      material,
      coating,
      color,
      sph,
      status,
      page: pageRaw,
      limit: limitRaw,
    } = req.query as Record<string, string | undefined>;

    const page  = Math.max(1, parseInt(pageRaw  ?? '1',  10) || 1);
    const limit = Math.min(Math.max(1, parseInt(limitRaw ?? '50', 10) || 50), 1000);
    const skip  = (page - 1) * limit;

    const filter: Record<string, unknown> = {};

    if (from || to) {
      const dateFilter: Record<string, Date> = {};
      if (from) {
        const d = new Date(from);
        if (isNaN(d.getTime())) { res.status(400).json({ message: 'Invalid "from" date.' }); return; }
        dateFilter.$gte = d;
      }
      if (to) {
        const d = new Date(to);
        if (isNaN(d.getTime())) { res.status(400).json({ message: 'Invalid "to" date.' }); return; }
        d.setHours(23, 59, 59, 999);
        dateFilter.$lte = d;
      }
      filter.purchaseDate = dateFilter;
    }

    if (lensType) filter.lensType = lensType;
    if (material) filter.material = material;
    if (coating)  filter.coating  = new RegExp(`^${coating.trim()}$`, 'i');
    if (color)    filter.color    = color;
    if (status === 'pending') {
      // Pending page: any entry explicitly marked pending OR missing a valid cost price
      filter.$or = [
        { status: 'pending' },
        { costPerPair: null },
        { costPerPair: 0 },
        { unitCost: null },
        { unitCost: 0 },
      ];
    } else {
      // Procurement Ledger: only received entries that have a valid cost price (> 0)
      filter.status = 'received';
      filter.$or = [
        { costPerPair: { $gt: 0 } },
        { unitCost: { $gt: 0 } },
      ];
    }
    if (sph !== undefined) {
      const sphNum = parseFloat(sph);
      if (isNaN(sphNum)) { res.status(400).json({ message: 'sph must be a number.' }); return; }
      filter.sph = sphNum;
    }

    const [total, rawEntries] = await Promise.all([
      PurchaseEntry.countDocuments(filter),
      PurchaseEntry.find(filter)
        .sort({ purchaseDate: -1, createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
    ]);

    const entries = await enrichPurchaseEntriesWithInvoices(rawEntries);

    res.json({
      total,
      page,
      pages: Math.ceil(total / limit),
      limit,
      entries,
    });
  } catch (error) {
    next(error);
  }
};

