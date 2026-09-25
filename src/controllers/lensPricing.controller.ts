import { NextFunction, Request, Response } from 'express';
import { LensPricing, LENS_TYPES, LENS_MATERIALS, LENS_COLORS, AXIS_TYPES } from '../models/LensPricing.model';
import { InvoiceItem } from '../models/InvoiceItem.model';
import { fail, ok } from '../utils/response';

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const getAll = async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const entries = await LensPricing.find().sort({ lensType: 1, material: 1, coating: 1, color: 1, axisType: 1, minSph: 1, minCyl: 1 });
    return ok(res, entries);
  } catch (e) { next(e); }
};

export const create = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { lensType, material, coating, color, axisType = 'any', minSph, maxSph, minCyl, maxCyl, minAdd, maxAdd, price, costPrice = 0 } = req.body;
    if (!LENS_TYPES.includes(lensType)) return fail(res, 'Invalid lensType', 400);
    if (!LENS_MATERIALS.includes(material)) return fail(res, 'Invalid material', 400);
    if (!LENS_COLORS.includes(color)) return fail(res, 'Invalid color', 400);
    if (!AXIS_TYPES.includes(axisType)) return fail(res, 'Invalid axisType', 400);
    if (!coating?.trim()) return fail(res, 'coating is required', 400);
    if (typeof price !== 'number' || price < 0) return fail(res, 'price must be >= 0', 400);
    if (typeof costPrice !== 'number' || costPrice < 0) return fail(res, 'costPrice must be >= 0', 400);
    if (typeof minSph !== 'number') return fail(res, 'minSph must be a number', 400);
    if (typeof maxSph !== 'number') return fail(res, 'maxSph must be a number', 400);
    if (typeof minCyl !== 'number') return fail(res, 'minCyl must be a number', 400);
    if (typeof maxCyl !== 'number') return fail(res, 'maxCyl must be a number', 400);

    const entry = await LensPricing.create({
      lensType, material, coating: coating.trim(), color, axisType,
      minSph, maxSph, minCyl, maxCyl,
      minAdd: minAdd ?? null,
      maxAdd: maxAdd ?? null,
      price, costPrice,
    });
    return ok(res, entry, 'Pricing rule created', 201);
  } catch (e) { next(e); }
};

export const update = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const entry = await LensPricing.findById(req.params.id);
    if (!entry) return fail(res, 'Not found', 404);

    const { lensType, material, coating, color, axisType, minSph, maxSph, minCyl, maxCyl, minAdd, maxAdd, price, costPrice } = req.body;

    if (lensType !== undefined) {
      if (!LENS_TYPES.includes(lensType)) return fail(res, 'Invalid lensType', 400);
      entry.lensType = lensType;
    }
    if (material !== undefined) {
      if (!LENS_MATERIALS.includes(material)) return fail(res, 'Invalid material', 400);
      entry.material = material;
    }
    if (color !== undefined) {
      if (!LENS_COLORS.includes(color)) return fail(res, 'Invalid color', 400);
      entry.color = color;
    }
    if (axisType !== undefined) {
      if (!AXIS_TYPES.includes(axisType)) return fail(res, 'Invalid axisType', 400);
      entry.axisType = axisType;
    }
    if (coating !== undefined) entry.coating = coating.trim();
    if (minSph !== undefined) entry.minSph = minSph;
    if (maxSph !== undefined) entry.maxSph = maxSph;
    if (minCyl !== undefined) entry.minCyl = minCyl;
    if (maxCyl !== undefined) entry.maxCyl = maxCyl;
    if ('minAdd' in req.body) entry.minAdd = minAdd ?? null;
    if ('maxAdd' in req.body) entry.maxAdd = maxAdd ?? null;
    if (price !== undefined) entry.price = price;
    if (costPrice !== undefined) entry.costPrice = costPrice;

    await entry.save();
    return ok(res, entry, 'Updated');
  } catch (e) { next(e); }
};

export const remove = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const entry = await LensPricing.findByIdAndDelete(req.params.id);
    if (!entry) return fail(res, 'Not found', 404);
    return ok(res, { _id: entry._id }, 'Deleted');
  } catch (e) { next(e); }
};

// GET /lens-pricing/lookup?lensType=&material=&coating=&color=&axisType=&sph=&cyl=&add=
// Priority: exact axisType match over 'any', then narrowest SPH range, then narrowest CYL range
export const lookup = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { lensType, material, coating, color, axisType = 'any', sph: qSph, cyl: qCyl, add: qAdd } = req.query as Record<string, string | undefined>;

    const sph = parseFloat(qSph ?? '');
    const cyl = parseFloat(qCyl ?? '');
    if (isNaN(sph)) return fail(res, 'sph must be a number', 400);
    if (isNaN(cyl)) return fail(res, 'cyl must be a number', 400);

    const hasAdd = qAdd !== undefined && qAdd !== '' && qAdd !== 'null';
    const addVal = hasAdd ? parseFloat(qAdd as string) : null;

    const baseQuery: Record<string, unknown> = {
      lensType, material, coating, color,
      axisType: { $in: [axisType, 'any'] },
      minSph: { $lte: sph },
      maxSph: { $gte: sph },
      minCyl: { $lte: cyl },
      maxCyl: { $gte: cyl },
    };

    if (addVal === null) {
      baseQuery.minAdd = null;
    } else {
      baseQuery.$and = [
        { minAdd: { $ne: null } },
        { minAdd: { $lte: addVal } },
        { $or: [{ maxAdd: null }, { maxAdd: { $gte: addVal } }] },
      ];
    }

    // Sort: exact axis match first (0) before 'any' (1), then narrowest range
    const [entry] = await LensPricing.aggregate([
      { $match: baseQuery },
      {
        $addFields: {
          _axisScore: { $cond: [{ $eq: ['$axisType', 'any'] }, 1, 0] },
          _sphRange:  { $subtract: ['$maxSph', '$minSph'] },
          _cylRange:  { $subtract: ['$maxCyl', '$minCyl'] },
        },
      },
      { $sort: { _axisScore: 1, _sphRange: 1, _cylRange: 1 } },
      { $limit: 1 },
      { $project: { _axisScore: 0, _sphRange: 0, _cylRange: 0 } },
    ]);

    return ok(res, entry ?? null);
  } catch (e) { next(e); }
};

// GET /lens-pricing/quote-history?sph=&cyl=&axis=&add=&lensType=&coating=&material=&color=&company=&limit=
export const getQuoteHistory = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const {
      sph: qSph,
      cyl: qCyl,
      axis: qAxis,
      add: qAdd,
      lensType,
      material,
      coating,
      color,
      company,
      limit = '20',
    } = req.query as Record<string, string | undefined>;

    const sph = qSph !== undefined && qSph !== '' ? parseFloat(qSph) : undefined;
    const cyl = qCyl !== undefined && qCyl !== '' ? parseFloat(qCyl) : undefined;
    const axis = qAxis !== undefined && qAxis !== '' ? parseFloat(qAxis) : undefined;
    const add = qAdd !== undefined && qAdd !== '' ? parseFloat(qAdd) : undefined;

    const matchConditions: Record<string, unknown>[] = [];

    // Only look at items that represent lenses (not frames or fragrances only)
    matchConditions.push({
      $or: [
        { opticalLens: { $ne: null } },
        { lensCompany: { $nin: [null, ''] } },
        { lensType: { $nin: [null, ''] } },
        { lensBrand: { $nin: [null, ''] } },
        { spherical: { $ne: null } },
        { rightSpherical: { $ne: null } },
        { leftSpherical: { $ne: null } },
        { prescription: { $ne: null } },
      ],
    });

    if (sph !== undefined && !isNaN(sph)) {
      matchConditions.push({
        $or: [
          { spherical: { $gte: sph - 0.25, $lte: sph + 0.25 } },
          { rightSpherical: { $gte: sph - 0.25, $lte: sph + 0.25 } },
          { leftSpherical: { $gte: sph - 0.25, $lte: sph + 0.25 } },
        ],
      });
    }

    if (cyl !== undefined && !isNaN(cyl)) {
      matchConditions.push({
        $or: [
          { cylinder: { $gte: cyl - 0.25, $lte: cyl + 0.25 } },
          { rightCylinder: { $gte: cyl - 0.25, $lte: cyl + 0.25 } },
          { leftCylinder: { $gte: cyl - 0.25, $lte: cyl + 0.25 } },
        ],
      });
    }

    if (add !== undefined && !isNaN(add)) {
      matchConditions.push({
        $or: [
          { addition: add },
          { rightAddition: add },
          { leftAddition: add },
        ],
      });
    }

    if (lensType && lensType.trim()) {
      const reg = new RegExp(escapeRegExp(lensType.trim()), 'i');
      matchConditions.push({
        $or: [{ lensType: reg }, { lensCategory: reg }],
      });
    }

    if (coating && coating.trim()) {
      const reg = new RegExp(escapeRegExp(coating.trim()), 'i');
      matchConditions.push({
        $or: [{ lensCoating: reg }],
      });
    }

    if (material && material.trim()) {
      const reg = new RegExp(escapeRegExp(material.trim()), 'i');
      matchConditions.push({
        $or: [{ lensMaterial: reg }, { lensIndex: reg }],
      });
    }

    if (color && color.trim()) {
      const reg = new RegExp(escapeRegExp(color.trim()), 'i');
      matchConditions.push({
        $or: [{ lensColor: reg }],
      });
    }

    if (company && company.trim()) {
      const reg = new RegExp(escapeRegExp(company.trim()), 'i');
      matchConditions.push({
        $or: [{ lensCompany: reg }, { lensBrand: reg }, { lensName: reg }],
      });
    }

    const itemFilter = matchConditions.length > 0 ? { $and: matchConditions } : {};
    const maxResults = Math.min(parseInt(limit, 10) || 20, 50);

    const history = await InvoiceItem.aggregate([
      { $match: itemFilter },
      { $sort: { createdAt: -1 } },
      { $limit: maxResults },
      {
        $lookup: {
          from: 'invoices',
          localField: '_id',
          foreignField: 'items',
          as: 'invoice',
        },
      },
      { $unwind: { path: '$invoice', preserveNullAndEmptyArrays: true } },
      {
        $lookup: {
          from: 'customers',
          localField: 'invoice.customer',
          foreignField: '_id',
          as: 'customer',
        },
      },
      { $unwind: { path: '$customer', preserveNullAndEmptyArrays: true } },
      {
        $project: {
          _id: 1,
          price: 1,
          costPrice: 1,
          mrp: 1,
          storePrice: 1,
          quantity: 1,
          lensType: 1,
          lensMaterial: 1,
          lensCoating: 1,
          lensColor: 1,
          lensCompany: 1,
          lensBrand: 1,
          lensName: 1,
          lensIndex: 1,
          spherical: 1,
          cylinder: 1,
          axis: 1,
          addition: 1,
          rightSpherical: 1,
          rightCylinder: 1,
          rightAxis: 1,
          rightAddition: 1,
          leftSpherical: 1,
          leftCylinder: 1,
          leftAxis: 1,
          leftAddition: 1,
          rightEyeNumber: 1,
          leftEyeNumber: 1,
          createdAt: 1,
          invoiceNumber: '$invoice.invoiceNumber',
          invoiceDate: '$invoice.billDate',
          invoiceTotal: '$invoice.total',
          customerName: '$customer.name',
          customerPhone: '$customer.phone',
        },
      },
    ]);

    // Also fetch benchmark standard price from catalog rate card if available
    let standardCardPrice = null;
    if (sph !== undefined && !isNaN(sph) && cyl !== undefined && !isNaN(cyl)) {
      try {
        const standardRule = await LensPricing.findOne({
          minSph: { $lte: sph },
          maxSph: { $gte: sph },
          minCyl: { $lte: cyl },
          maxCyl: { $gte: cyl },
          ...(lensType ? { lensType } : {}),
          ...(material ? { material } : {}),
          ...(coating ? { coating: new RegExp(escapeRegExp(coating), 'i') } : {}),
        });
        if (standardRule) {
          standardCardPrice = {
            price: standardRule.price,
            costPrice: standardRule.costPrice,
            ruleId: standardRule._id,
          };
        }
      } catch (err) {
        // benchmark lookup error ignored
      }
    }

    return ok(res, {
      count: history.length,
      standardCardPrice,
      quotes: history,
    });
  } catch (e) {
    next(e);
  }
};

// GET /lens-pricing/options?sph=&cyl=&add=&lensType=
// Finds all relevant lens choices matching the customer's RX across categories (Standard, Blue Cut, High Index, Progressive, Photochromic)
export const getPresentationOptions = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { sph: qSph, cyl: qCyl, add: qAdd, lensType = 'Single Vision' } = req.query as Record<string, string | undefined>;

    const sph = Math.abs(parseFloat(qSph ?? '0'));
    const cyl = Math.abs(parseFloat(qCyl ?? '0'));
    const add = qAdd ? Math.abs(parseFloat(qAdd)) : null;

    const baseQuery: Record<string, unknown> = {
      minSph: { $lte: sph },
      maxSph: { $gte: sph },
      minCyl: { $lte: cyl },
      maxCyl: { $gte: cyl },
    };

    if (lensType) {
      baseQuery.lensType = lensType;
    }

    if (add !== null && add > 0) {
      baseQuery.$or = [
        { minAdd: null },
        { minAdd: { $lte: add }, maxAdd: { $gte: add } },
        { minAdd: { $lte: add }, maxAdd: null },
      ];
    }

    const options = await LensPricing.find(baseQuery).sort({ price: 1, costPrice: 1 });

    return ok(res, {
      rx: { sph, cyl, add, lensType },
      count: options.length,
      options,
    });
  } catch (e) {
    next(e);
  }
};

// POST /lens-pricing/seed-enterprise
// Seeds or updates Enterprise Ophthalmics Feb 2024 price list into DB
export const seedEnterpriseCatalog = async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const wholesaleName = 'Enterprise Ophthalmics';
    const effDate = 'Feb 2024';

    // Sample Enterprise Catalog Seed
    const enterpriseRules = [
      // 1. Scratch Guard 56
      { lensType: 'Single Vision', material: 'Fiber', coating: 'Hard Coat (HC)', color: 'White', axisType: 'any', minSph: 0, maxSph: 8, minCyl: 0, maxCyl: 2, price: 450, costPrice: 140, wholesaler: wholesaleName, brand: 'Scratch Guard 56', features: ['Scratch Resistant', 'Hard Coat', 'Value Standard'], effectiveDate: effDate, dia: '70/65' },
      { lensType: 'Single Vision', material: 'Fiber', coating: 'Hard Coat (HC)', color: 'White', axisType: 'any', minSph: 0, maxSph: 6, minCyl: 2.25, maxCyl: 4, price: 650, costPrice: 220, wholesaler: wholesaleName, brand: 'Scratch Guard 56 High Cyl', features: ['Scratch Resistant', 'High Cylinder'], effectiveDate: effDate, dia: '70' },
      { lensType: 'Single Vision', material: 'Fiber', coating: 'Hard Coat (HC)', color: 'White', axisType: 'any', minSph: 0, maxSph: 1.75, minCyl: 0, maxCyl: 2, price: 500, costPrice: 160, wholesaler: wholesaleName, brand: 'Scratch Guard 56 Plus', features: ['Scratch Resistant'], effectiveDate: effDate, dia: '65' },

      // 2. Radiator 56 Green
      { lensType: 'Single Vision', material: 'Fiber', coating: 'Green HMC', color: 'White', axisType: 'any', minSph: 0, maxSph: 4, minCyl: 0, maxCyl: 2, price: 600, costPrice: 165, wholesaler: wholesaleName, brand: 'Radiator 56 Green', features: ['Anti-Glare HMC', 'Green Reflection', 'Clean Vision'], effectiveDate: effDate, dia: '70' },
      { lensType: 'Single Vision', material: 'Fiber', coating: 'Green HMC', color: 'White', axisType: 'any', minSph: 4.25, maxSph: 6, minCyl: 0, maxCyl: 2, price: 750, costPrice: 220, wholesaler: wholesaleName, brand: 'Radiator 56 Green', features: ['Anti-Glare HMC', 'Green Reflection'], effectiveDate: effDate, dia: '70' },
      { lensType: 'Single Vision', material: 'Fiber', coating: 'Green HMC', color: 'White', axisType: 'any', minSph: 6.25, maxSph: 10, minCyl: 0, maxCyl: 2, price: 950, costPrice: 325, wholesaler: wholesaleName, brand: 'Radiator 56 Green High Power', features: ['Anti-Glare HMC', 'Extended Power'], effectiveDate: effDate, dia: '70' },

      // 3. Egalite 56 ASP SHMC
      { lensType: 'Single Vision', material: 'Fiber', coating: 'SHMC Hydrophobic', color: 'White', axisType: 'any', minSph: 0, maxSph: 6, minCyl: 0, maxCyl: 2, price: 950, costPrice: 290, wholesaler: wholesaleName, brand: 'Egalite 56 ASP', features: ['Aspheric Design', 'Super Hydrophobic', 'Dust & Water Repellent'], effectiveDate: effDate, dia: '70/65' },

      // 4. Egalite 56 ASP SHMC Blue Block
      { lensType: 'Single Vision', material: 'Fiber', coating: 'Blue Block SHMC', color: 'White', axisType: 'any', minSph: 0, maxSph: 6, minCyl: 0, maxCyl: 2, price: 1200, costPrice: 350, wholesaler: wholesaleName, brand: 'Egalite 56 Blue Cut', features: ['Blue Light Protection', 'Digital Screen Armor', 'Super Hydrophobic'], effectiveDate: effDate, dia: '70/65' },
      { lensType: 'Single Vision', material: 'Fiber', coating: 'Blue Block SHMC', color: 'White', axisType: 'any', minSph: 0, maxSph: 6, minCyl: 2.25, maxCyl: 4, price: 1450, costPrice: 475, wholesaler: wholesaleName, brand: 'Egalite 56 Blue Cut High Cyl', features: ['Blue Light Protection', 'High Cylinder Support'], effectiveDate: effDate, dia: '70/65' },

      // 5. Egalite 61 (MR8) ASP SHMC Blue Block (1.60 High Index)
      { lensType: 'Single Vision', material: 'Fiber', coating: 'Blue Block 1.60 SHMC', color: 'White', axisType: 'any', minSph: 0, maxSph: 10, minCyl: 0, maxCyl: 2, price: 1800, costPrice: 585, wholesaler: wholesaleName, brand: 'Egalite 61 MR8 Thin', features: ['1.60 Thin High Index', 'MR8 Toughness', 'Blue Light Shield', '20% Thinner'], effectiveDate: effDate, dia: '70' },

      // 6. Egalite 67 (MR7) ASP SHMC Blue Block (1.67 Ultra-Thin)
      { lensType: 'Single Vision', material: 'Fiber', coating: 'Blue Block 1.67 SHMC', color: 'White', axisType: 'any', minSph: 2, maxSph: 12, minCyl: 0, maxCyl: 2, price: 2800, costPrice: 860, wholesaler: wholesaleName, brand: 'Egalite 67 MR7 Ultra-Thin', features: ['1.67 Ultra-Thin', 'MR7 Premium Index', '35% Thinner & Lighter', 'Blue Cut Armor'], effectiveDate: effDate, dia: '70' },

      // 7. Advanced Clear Drive 1.60 (MR8) Blue Cut
      { lensType: 'Single Vision', material: 'Fiber', coating: 'Clear Drive Blue Cut', color: 'White', axisType: 'any', minSph: 0, maxSph: 8, minCyl: 0, maxCyl: 2, price: 2900, costPrice: 900, wholesaler: wholesaleName, brand: 'Advanced Clear Drive 1.60', features: ['Anti-Glare Night Drive', 'Clear Vision Coating', 'Blue Cut UV420', '1.60 Thin'], effectiveDate: effDate, dia: '74' },

      // 8. Terco (Polycarbonate)
      { lensType: 'Single Vision', material: 'Polycarbonate', coating: 'Hard Coat (HC)', color: 'White', axisType: 'any', minSph: 0, maxSph: 6, minCyl: 0, maxCyl: 2, price: 1500, costPrice: 350, wholesaler: wholesaleName, brand: 'Terco Polycarbonate', features: ['Unbreakable Safety Lens', 'Sports & Rimless Tough', 'Ultra Light'], effectiveDate: effDate, dia: '70/65' },
      { lensType: 'Single Vision', material: 'Polycarbonate', coating: 'Hydrophobic SHMC', color: 'White', axisType: 'any', minSph: 0, maxSph: 6, minCyl: 0, maxCyl: 2, price: 1800, costPrice: 550, wholesaler: wholesaleName, brand: 'Terco Hydro Poly', features: ['Unbreakable Polycarbonate', 'Super Hydrophobic Coating', 'Impact Resistant'], effectiveDate: effDate, dia: '70/65' },

      // 9. Chroma Fast (Photochromic)
      { lensType: 'Single Vision', material: 'Fiber', coating: 'Photochromic HMC', color: 'Photo Chromatic', axisType: 'any', minSph: 0, maxSph: 4, minCyl: 0, maxCyl: 2, price: 1950, costPrice: 595, wholesaler: wholesaleName, brand: 'Chroma Fast Sun-Sens', features: ['Fast Outdoor Darkening', 'Indoor Clear Transition', 'UV Sun Shield'], effectiveDate: effDate, dia: '70/65' },

      // 10. Chemi 1.74 ASP SHMC (Ultra High Index 1.74)
      { lensType: 'Single Vision', material: 'Fiber', coating: 'Blue Cut 1.74 SHMC', color: 'White', axisType: 'any', minSph: 3, maxSph: 12, minCyl: 0, maxCyl: 2, price: 7500, costPrice: 2750, wholesaler: wholesaleName, brand: 'Chemi 1.74 Ultra-Slim', features: ['1.74 Highest Index', '50% Thinner Edges', 'Flatest Aspheric Profile', 'Premium Japan MR174'], effectiveDate: effDate, dia: '75/70' },

      // 11. Verso Progressives
      { lensType: 'Progressive', material: 'Fiber', coating: 'HMC Coating', color: 'White', axisType: 'any', minSph: 0, maxSph: 3, minCyl: 0, maxCyl: 2, minAdd: 1, maxAdd: 3.5, price: 1500, costPrice: 480, wholesaler: wholesaleName, brand: 'Verso Standard Progressive', features: ['Smooth Distance-to-Near', 'No Visible Lines', 'Anti-Reflective HMC'], effectiveDate: effDate, dia: '70' },
      { lensType: 'Progressive', material: 'Fiber', coating: 'Blue Cut HMC+', color: 'White', axisType: 'any', minSph: 0, maxSph: 3, minCyl: 0, maxCyl: 2, minAdd: 1, maxAdd: 3.5, price: 2400, costPrice: 610, wholesaler: wholesaleName, brand: 'Verso Advanced Blue Cut', features: ['Wide Corridor Progressive', 'Digital Blue Light Filter', 'Super Hydrophobic'], effectiveDate: effDate, dia: '70' },
      { lensType: 'Progressive', material: 'Fiber', coating: 'DriveX Anti-Glare', color: 'White', axisType: 'any', minSph: 0, maxSph: 3, minCyl: 0, maxCyl: 2, minAdd: 1, maxAdd: 3.5, price: 2900, costPrice: 900, wholesaler: wholesaleName, brand: 'Verso Advanced DriveX', features: ['Night Driving Progressive', 'Expanded Intermediate Corridor', 'Anti-Glare Drive Coat'], effectiveDate: effDate, dia: '70' },
      { lensType: 'Progressive', material: 'Fiber', coating: 'Freeform Digital 1.60', color: 'White', axisType: 'any', minSph: 0, maxSph: 6, minCyl: 0, maxCyl: 2, minAdd: 1, maxAdd: 3.5, price: 4800, costPrice: 1650, wholesaler: wholesaleName, brand: 'Verso 1.60 Digital Bluecut', features: ['Custom Back-Surface Freeform', '1.60 High Index Thin', 'Blue Light Shield', 'Zero Distortion'], effectiveDate: effDate, dia: '70/65' },
    ];

    let insertedCount = 0;
    for (const rule of enterpriseRules) {
      await LensPricing.updateOne(
        {
          wholesaler: rule.wholesaler,
          brand: rule.brand,
          minSph: rule.minSph,
          maxSph: rule.maxSph,
          minCyl: rule.minCyl,
          maxCyl: rule.maxCyl,
        },
        { $set: rule },
        { upsert: true }
      );
      insertedCount++;
    }

    return ok(res, { count: insertedCount, message: `Successfully seeded ${insertedCount} Enterprise Ophthalmics lens rules.` });
  } catch (e) {
    next(e);
  }
};

