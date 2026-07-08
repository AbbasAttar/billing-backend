import { Request, Response, NextFunction } from 'express';
import { FrameStock } from '../models/FrameStock.model';
import { FrameCompany } from '../models/FrameCompany.model';
import { ok, fail } from '../utils/response';

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                     'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Parses a 10-digit frame code into its components.
// Format: CC PPPP MM YY  (all digits)
function parseFrameCode(code: string): {
  companyCode: string;
  costPrice: number;
  month: number;
  year: number;
} | null {
  if (!/^\d{10}$/.test(code)) return null;
  const companyCode = code.slice(0, 2);
  const costPrice   = parseInt(code.slice(2, 6), 10);
  const month       = parseInt(code.slice(6, 8), 10);
  const year        = 2000 + parseInt(code.slice(8, 10), 10);
  if (month < 1 || month > 12) return null;
  if (costPrice <= 0) return null;
  return { companyCode, costPrice, month, year };
}

// ── DECODE (no auth needed, just a helper) ────────────────────────────────────

export const decode = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const code = String(req.params.code ?? '').trim();
    const parsed = parseFrameCode(code);
    if (!parsed) return fail(res, 'Invalid frame code — must be exactly 10 digits (CCPPPPMMYY)', 400);

    const company = await FrameCompany.findOne({ code: parsed.companyCode });
    return ok(res, {
      frameCode:    code,
      companyCode:  parsed.companyCode,
      companyName:  company?.name ?? null,
      costPrice:    parsed.costPrice,
      purchaseMonth: parsed.month,
      purchaseYear:  parsed.year,
      monthLabel:   MONTH_NAMES[parsed.month - 1],
      suggestedSellMin: Math.round(parsed.costPrice * 3),
      suggestedSellMax: Math.round(parsed.costPrice * 3.5),
      knownCompany: !!company,
    });
  } catch (e) { next(e); }
};

// ── GET all ───────────────────────────────────────────────────────────────────

export const getAll = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { companyCode, lowStock } = req.query as Record<string, string>;
    const filter: Record<string, unknown> = {};
    if (companyCode) filter.companyCode = companyCode;
    if (lowStock === 'true') filter.$expr = { $lte: ['$quantity', '$reorderLevel'] };

    const stock = await FrameStock.find(filter).sort({ companyCode: 1, purchaseYear: -1, purchaseMonth: -1 });
    return ok(res, stock);
  } catch (e) { next(e); }
};

// ── CREATE ────────────────────────────────────────────────────────────────────

export const create = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { frameCode, sellPrice, quantity, reorderLevel } = req.body as {
      frameCode:    string;
      sellPrice:    number;
      quantity?:    number;
      reorderLevel?: number;
    };

    const code = String(frameCode ?? '').trim();
    const parsed = parseFrameCode(code);
    if (!parsed) return fail(res, 'Invalid frame code — must be exactly 10 digits (CCPPPPMMYY)', 400);
    if (typeof sellPrice !== 'number' || sellPrice < 0) return fail(res, 'sellPrice must be a non-negative number', 400);

    const company = await FrameCompany.findOne({ code: parsed.companyCode });
    if (!company) return fail(res, `Unknown company code "${parsed.companyCode}" — add it in Settings → Frame Companies first`, 400);

    const qty = typeof quantity === 'number' ? quantity : 0;

    // If same code already exists, increment quantity instead of failing
    const existing = await FrameStock.findOne({ frameCode: code });
    if (existing) {
      existing.quantity += qty;
      existing.sellPrice = sellPrice;
      await existing.save();
      return ok(res, existing, 'Frame stock quantity updated');
    }

    const entry = await FrameStock.create({
      frameCode:     code,
      companyCode:   parsed.companyCode,
      companyName:   company.name,
      costPrice:     parsed.costPrice,
      sellPrice,
      purchaseMonth: parsed.month,
      purchaseYear:  parsed.year,
      quantity:      qty,
      reorderLevel:  typeof reorderLevel === 'number' ? reorderLevel : 2,
    });
    return ok(res, entry, 'Frame stock entry created', 201);
  } catch (e: any) {
    next(e);
  }
};

// ── UPDATE ────────────────────────────────────────────────────────────────────

export const update = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { sellPrice, quantity, reorderLevel } = req.body as {
      sellPrice?:    number;
      quantity?:     number;
      reorderLevel?: number;
    };
    const patch: Record<string, unknown> = {};
    if (sellPrice    !== undefined) patch.sellPrice    = sellPrice;
    if (quantity     !== undefined) patch.quantity     = quantity;
    if (reorderLevel !== undefined) patch.reorderLevel = reorderLevel;

    const entry = await FrameStock.findByIdAndUpdate(req.params.id, patch, { new: true, runValidators: true });
    if (!entry) return fail(res, 'Stock entry not found', 404);
    return ok(res, entry);
  } catch (e) { next(e); }
};

// ── ADJUST quantity ───────────────────────────────────────────────────────────

export const adjust = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { delta } = req.body as { delta?: number };
    if (typeof delta !== 'number') return fail(res, 'delta is required and must be a number', 400);

    const entry = await FrameStock.findById(req.params.id);
    if (!entry) return fail(res, 'Stock entry not found', 404);

    const newQty = entry.quantity + delta;
    if (newQty < 0) return fail(res, 'Cannot reduce quantity below 0', 400);
    entry.quantity = newQty;
    await entry.save();
    return ok(res, entry);
  } catch (e) { next(e); }
};

// ── DELETE ────────────────────────────────────────────────────────────────────

export const remove = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const entry = await FrameStock.findByIdAndDelete(req.params.id);
    if (!entry) return fail(res, 'Stock entry not found', 404);
    return ok(res, { _id: entry._id }, 'Deleted');
  } catch (e) { next(e); }
};
