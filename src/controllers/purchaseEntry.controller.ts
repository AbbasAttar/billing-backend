import { Request, Response, NextFunction } from 'express';
import { PurchaseEntry } from '../models/PurchaseEntry.model';
import { LensStock } from '../models/LensStock.model';
import { LENS_TYPES, LENS_MATERIALS, LENS_COLORS } from '../models/LensPricing.model';

// ── Validation ────────────────────────────────────────────────────────────────

const EYE_VALUES = ['right', 'left', 'both'] as const;
type EyeValue = typeof EYE_VALUES[number];

interface RawEntry {
  lensType:      unknown;
  material:      unknown;
  coating:       unknown;
  color:         unknown;
  eye?:          unknown;
  sph:           unknown;
  cyl?:          unknown;
  add?:          unknown;
  qty:           unknown;
  costPerPair:   unknown;
  supplier?:     unknown;
  notes?:        unknown;
  purchaseDate?: unknown;
}

function validateEntry(raw: RawEntry, idx: number): string | null {
  if (!LENS_TYPES.includes(raw.lensType as typeof LENS_TYPES[number]))
    return `Entry ${idx + 1}: invalid lensType "${raw.lensType}".`;
  if (!LENS_MATERIALS.includes(raw.material as typeof LENS_MATERIALS[number]))
    return `Entry ${idx + 1}: invalid material "${raw.material}".`;
  if (!LENS_COLORS.includes(raw.color as typeof LENS_COLORS[number]))
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
  if (typeof raw.costPerPair !== 'number' || raw.costPerPair < 0)
    return `Entry ${idx + 1}: costPerPair must be a non-negative number.`;
  return null;
}

// ── POST /api/purchases — bulk create (Log Purchase, status=received) ─────────

export const createPurchaseEntries = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const body = req.body;

    if (!Array.isArray(body) || body.length === 0) {
      res.status(400).json({ message: 'Request body must be a non-empty array of entries.' });
      return;
    }

    for (let i = 0; i < body.length; i++) {
      const err = validateEntry(body[i] as RawEntry, i);
      if (err) {
        res.status(400).json({ message: err });
        return;
      }
    }

    const created: unknown[] = [];

    for (const raw of body as RawEntry[]) {
      const lensType    = raw.lensType    as typeof LENS_TYPES[number];
      const material    = raw.material    as typeof LENS_MATERIALS[number];
      const coating     = (raw.coating as string).trim();
      const color       = raw.color       as typeof LENS_COLORS[number];
      const eye         = EYE_VALUES.includes(raw.eye as EyeValue) ? (raw.eye as EyeValue) : 'both';
      const sph         = raw.sph         as number;
      const cyl         = typeof raw.cyl === 'number'  ? raw.cyl  : 0;
      const add         = typeof raw.add === 'number'  ? raw.add  : null;
      const qty         = raw.qty         as number;
      const costPerPair = raw.costPerPair as number;

      let purchaseDate: Date;
      if (raw.purchaseDate) {
        purchaseDate = new Date(raw.purchaseDate as string);
        if (isNaN(purchaseDate.getTime())) {
          res.status(400).json({ message: `Entry with sph ${sph}: purchaseDate is not a valid date.` });
          return;
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
        eye,
        sph,
        cyl,
        add,
        qty,
        costPerPair,
        supplier:     raw.supplier     ? String(raw.supplier).trim()  : null,
        notes:        raw.notes        ? String(raw.notes).trim()     : null,
        purchaseDate,
      });

      await LensStock.findOneAndUpdate(
        { lensType, material, coating, color, sph, cyl, add },
        {
          $inc: { quantity: qty },
          $set: { lastCost: costPerPair },
          $setOnInsert: { reorderLevel: 2, costPrice: costPerPair },
        },
        { upsert: true, new: true, runValidators: false },
      );

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
  id:           string;
  costPerPair:  number;
  lensType?:    string;
  material?:    string;
  coating?:     string;
  color?:       string;
  sph?:         number;
  cyl?:         number;
  add?:         number | null;
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

    for (let i = 0; i < body.length; i++) {
      const item = body[i] as ReceiveItemInput;

      if (typeof item.id !== 'string' || !item.id.trim())
        return void res.status(400).json({ message: `Item ${i + 1}: id is required.` });
      if (typeof item.costPerPair !== 'number' || item.costPerPair < 0)
        return void res.status(400).json({ message: `Item ${i + 1}: costPerPair must be a non-negative number.` });

      const entry = await PurchaseEntry.findById(item.id);
      if (!entry)
        return void res.status(404).json({ message: `Entry ${item.id} not found.` });
      if (entry.status === 'received')
        return void res.status(400).json({ message: `Entry ${item.id} is already received.` });

      // Apply any SKU overrides from request body
      if (item.lensType && LENS_TYPES.includes(item.lensType as typeof LENS_TYPES[number]))
        entry.lensType = item.lensType as typeof LENS_TYPES[number];
      if (item.material && LENS_MATERIALS.includes(item.material as typeof LENS_MATERIALS[number]))
        entry.material = item.material as typeof LENS_MATERIALS[number];
      if (item.coating && item.coating.trim()) entry.coating = item.coating.trim();
      if (item.color && LENS_COLORS.includes(item.color as typeof LENS_COLORS[number]))
        entry.color = item.color as typeof LENS_COLORS[number];
      if (item.sph !== undefined) entry.sph = item.sph;
      if (item.cyl !== undefined) entry.cyl = item.cyl;
      if (item.add !== undefined) entry.add = item.add;

      entry.status      = 'received';
      entry.costPerPair = item.costPerPair;
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
        await LensStock.findOneAndUpdate(
          { lensType: lt, material: mat, coating: coat, color: col, sph, cyl: cylVal, add: addVal },
          {
            $inc: { quantity: entry.qty },
            $set: { lastCost: item.costPerPair },
            $setOnInsert: { reorderLevel: 2, costPrice: item.costPerPair },
          },
          { upsert: true, new: true, runValidators: false },
        );
      }

      updated.push(entry);
    }

    res.json({ count: updated.length, entries: updated });
  } catch (error) {
    next(error);
  }
};

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
    const limit = Math.min(Math.max(1, parseInt(limitRaw ?? '50', 10) || 50), 200);
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
    if (status === 'pending' || status === 'received') {
      filter.status = status;
    } else {
      // default: exclude pending (shown separately in the Pending Orders card)
      filter.status = { $ne: 'pending' };
    }
    if (sph !== undefined) {
      const sphNum = parseFloat(sph);
      if (isNaN(sphNum)) { res.status(400).json({ message: 'sph must be a number.' }); return; }
      filter.sph = sphNum;
    }

    const [total, entries] = await Promise.all([
      PurchaseEntry.countDocuments(filter),
      PurchaseEntry.find(filter)
        .sort({ purchaseDate: -1, createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
    ]);

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
