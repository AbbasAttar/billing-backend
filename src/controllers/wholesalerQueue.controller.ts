import { Request, Response, NextFunction } from 'express';
import mongoose from 'mongoose';
import { InvoiceItem } from '../models/InvoiceItem.model';
import { Invoice } from '../models/Invoice.model';
import { PurchaseEntry } from '../models/PurchaseEntry.model';
import { Frame } from '../models/Frame.model';

// Helper to format power values cleanly (+ for positive, - for negative, no sign for 0.00)
function formatPowerVal(val: number): string {
  if (Math.abs(val) < 0.0001) return '0.00';
  return `${val > 0 ? '+' : ''}${val.toFixed(2)}`;
}

// Helper to format an eye Rx cleanly (e.g. "SPH 0.00 / CYL -3.50 × 180° | ADD +2.00")
function formatEyePower(
  sph: number | null | undefined,
  cyl: number | null | undefined,
  axis: number | null | undefined,
  add: number | null | undefined,
): string {
  if (sph === null && cyl === null && add === null && axis === null) return 'Plano / Normal';
  const parts: string[] = [];
  if (sph !== null && sph !== undefined) {
    parts.push(`SPH ${formatPowerVal(sph)}`);
  }
  if (cyl !== null && cyl !== undefined && Math.abs(cyl) >= 0.0001) {
    parts.push(`CYL ${formatPowerVal(cyl)}`);
    if (axis !== null && axis !== undefined) {
      parts.push(`× ${axis}°`);
    }
  }
  if (add !== null && add !== undefined && Math.abs(add) >= 0.0001) {
    parts.push(`ADD ${formatPowerVal(add)}`);
  }
  return parts.length > 0 ? parts.join(' ') : 'Plano';
}

// Helper to format eye summary power (e.g. "0.00 -3.50 × 180°" or "0.00 +0.50 × 90° Add 2.00" or "0.00 Add 2.25")
function formatEyeSummaryPower(
  sph: number | null | undefined,
  cyl: number | null | undefined,
  axis: number | null | undefined,
  add: number | null | undefined,
): string {
  const parts: string[] = [];
  const sphVal = sph ?? 0;
  const sphStr = Math.abs(sphVal) < 0.0001 ? '0.00' : sphVal > 0 ? `+${sphVal.toFixed(2)}` : `${sphVal.toFixed(2)}`;
  parts.push(sphStr);

  if (cyl !== null && cyl !== undefined && Math.abs(cyl) >= 0.0001) {
    const cylStr = Math.abs(cyl) < 0.0001 ? '0.00' : cyl > 0 ? `+${cyl.toFixed(2)}` : `${cyl.toFixed(2)}`;
    let cylAxis = cylStr;
    if (axis !== null && axis !== undefined) {
      cylAxis += ` × ${axis}°`;
    }
    parts.push(cylAxis);
  }

  if (add !== null && add !== undefined && Math.abs(add) >= 0.0001) {
    parts.push(`Add ${Math.abs(add).toFixed(2)}`);
  }

  return parts.join(' ');
}

// Helper to format compact lens specs (e.g. "PG HC KT", "CR HC", "PG HC", "HC KT", "ARC Progressive")
function formatCompactLensSpecs(item: any): string {
  const parts: string[] = [];
  const type = (item.lensType || item.lensCategory || item.opticalLens?.category || '').toLowerCase();
  const mat = (item.lensMaterial || '').toLowerCase();
  const coat = (item.lensCoating || item.opticalLens?.coating || '').toLowerCase();
  const col = (item.lensColor || '').toLowerCase();
  const fullText = `${type} ${mat} ${coat} ${col} ${item.opticalLens?.name || ''}`.toLowerCase();

  // 1. Color / Photochromic prefix
  if (fullText.includes('photo brown') || fullText.includes('pb') || fullText.includes('brown')) {
    parts.push('PB');
  } else if (
    fullText.includes('photo') ||
    fullText.includes('photochromic') ||
    fullText.includes('pg') ||
    fullText.includes('grey') ||
    fullText.includes('gray')
  ) {
    parts.push('PG');
  } else if (mat.includes('cr') || mat.includes('fiber') || mat.includes('cr-39')) {
    if (!type.includes('bifocal') && !type.includes('kryptok') && !type.includes('kt')) {
      parts.push('CR');
    }
  } else if (mat.includes('glass')) {
    parts.push('Glass');
  } else if (mat.includes('pc') || mat.includes('poly')) {
    parts.push('PC');
  }

  // 2. Coating
  if (
    fullText.includes('bb') ||
    fullText.includes('blue block') ||
    fullText.includes('blue cut') ||
    fullText.includes('blue light') ||
    fullText.includes('uv420')
  ) {
    parts.push('BB');
  } else if (
    fullText.includes('arc') ||
    fullText.includes('anti-glare') ||
    fullText.includes('anti-reflective') ||
    fullText.includes('anti glare') ||
    fullText.includes('hmc') ||
    fullText.includes('green')
  ) {
    parts.push('ARC');
  } else if (
    fullText.includes('hc') ||
    fullText.includes('hard coat') ||
    fullText.includes('hardcoat') ||
    fullText.includes('hard-coat')
  ) {
    parts.push('HC');
  }

  // 3. Lens Type Suffix
  if (
    fullText.includes('d-bifocal') ||
    fullText.includes('d bifocal') ||
    fullText.includes('flat top') ||
    fullText.includes('flattop')
  ) {
    parts.push('D-Bifocal');
  } else if (
    fullText.includes('bifocal') ||
    fullText.includes('kryptok') ||
    fullText.includes('kt') ||
    fullText.includes('round bifocal')
  ) {
    parts.push('KT');
  } else if (
    fullText.includes('progressive') ||
    fullText.includes('pal') ||
    fullText.includes('varilux')
  ) {
    parts.push('Progressive');
  }

  if (parts.length === 0) {
    if (item.lensType) parts.push(item.lensType);
    if (item.lensCoating) parts.push(item.lensCoating);
  }

  return parts.join(' ');
}

// ── GET /api/wholesaler-queue ─────────────────────────────────────────────────
export const getPendingOrderItems = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const statusFilter = (req.query.status as string) || 'all';
    const dateQuery = req.query.date as string | undefined;

    const query: Record<string, any> = {
      $or: [
        { fulfillmentSource: 'ordered' },
        { lensType: { $exists: true, $ne: null } },
        { opticalLens: { $exists: true, $ne: null } },
      ],
    };

    if (statusFilter === 'pending') {
      query.$and = [
        { $or: [{ sentToWholesaler: { $ne: true } }, { labStatus: 'pending' }] },
        { labStatus: { $nin: ['received', 'fitted', 'cancelled'] } },
      ];
    } else if (statusFilter === 'sent') {
      query.sentToWholesaler = true;
      query.labStatus = { $in: ['sent', 'pending'] };
    } else if (statusFilter === 'received') {
      query.labStatus = 'received';
    } else if (statusFilter === 'fitted') {
      query.labStatus = 'fitted';
    }

    if (dateQuery) {
      const startOfDay = new Date(dateQuery);
      startOfDay.setHours(0, 0, 0, 0);
      const endOfDay = new Date(dateQuery);
      endOfDay.setHours(23, 59, 59, 999);
      query.createdAt = { $gte: startOfDay, $lte: endOfDay };
    }

    const items = await InvoiceItem.find(query)
      .populate('frame', 'name companyName houseName frameCode web')
      .populate('opticalLens', 'name brand category coating index')
      .sort({ createdAt: -1 })
      .lean();

    if (items.length === 0) {
      res.json({ count: 0, items: [] });
      return;
    }

    // Reverse-lookup: find invoices that reference these items
    const itemIds = items.map((i) => i._id);
    const invoices = await Invoice.find({ items: { $in: itemIds } })
      .populate<{ customer: { _id: mongoose.Types.ObjectId; name: string; mobileNumber: string } }>(
        'customer',
        'name mobileNumber',
      )
      .populate({
        path: 'items',
        populate: { path: 'frame', select: 'name companyName houseName frameCode' },
      })
      .lean();

    // Map: itemId -> invoice & customer & paired frame context
    const itemCtx = new Map<
      string,
      {
        invoiceNumber: string | null;
        invoiceId: string;
        billDate: Date;
        customerName: string;
        customerPhone: string;
        pairedFrameName?: string | null;
        pairedFrameCode?: string | null;
      }
    >();

    for (const inv of invoices) {
      const cust = inv.customer as { name?: string; mobileNumber?: string } | null;
      const invItems = (inv.items as any[]) || [];
      // Find if there is a frame item in this invoice
      const frameItem = invItems.find((it) => it.frame || it.type === 'frame');
      const frameObj = frameItem?.frame as any;
      const pairedFrameName = frameObj?.houseName || frameObj?.name || frameItem?.lensBrand || null;
      const pairedFrameCode = frameObj?.frameCode || null;

      for (const itemRef of inv.items) {
        const key = (itemRef._id || itemRef).toString();
        if (!itemCtx.has(key)) {
          itemCtx.set(key, {
            invoiceId: (inv._id as mongoose.Types.ObjectId).toString(),
            invoiceNumber: inv.invoiceNumber ?? null,
            billDate: inv.billDate,
            customerName: cust?.name ?? 'Walk-in Client',
            customerPhone: cust?.mobileNumber ?? '',
            pairedFrameName,
            pairedFrameCode,
          });
        }
      }
    }

    const enriched = items.map((item: any) => {
      const rightSph = item.rightSpherical ?? item.spherical ?? null;
      const rightCyl = item.rightCylinder ?? item.cylinder ?? null;
      const rightAxis = item.rightAxis ?? item.axis ?? null;
      const rightAdd = item.rightAddition ?? item.addition ?? null;

      const leftSph = item.leftSpherical ?? (item.isSameNumber ? rightSph : null);
      const leftCyl = item.leftCylinder ?? (item.isSameNumber ? rightCyl : null);
      const leftAxis = item.leftAxis ?? (item.isSameNumber ? rightAxis : null);
      const leftAdd = item.leftAddition ?? (item.isSameNumber ? rightAdd : null);

      const ctx = itemCtx.get((item._id as mongoose.Types.ObjectId).toString()) ?? null;
      const frameData = item.frame || null;
      const fallbackCtx = {
        invoiceNumber: 'Direct Order',
        invoiceId: '',
        billDate: item.createdAt,
        customerName: item.userName || 'Direct Client',
        customerPhone: '',
        pairedFrameName: item.frameVariantLabel || null,
        pairedFrameCode: null,
      };

      const reRx = formatEyePower(rightSph, rightCyl, rightAxis, rightAdd);
      const leRx = formatEyePower(leftSph, leftCyl, leftAxis, leftAdd);
      const isSameEye = reRx === leRx;
      const reSummary = formatEyeSummaryPower(rightSph, rightCyl, rightAxis, rightAdd);
      const leSummary = formatEyeSummaryPower(leftSph, leftCyl, leftAxis, leftAdd);
      const compactSpecs = formatCompactLensSpecs(item);

      return {
        ...item,
        reSummary,
        leSummary,
        compactSpecs,
        labStatus: item.labStatus || (item.sentToWholesaler ? 'sent' : 'pending'),
        formattedRx: {
          re: reRx,
          le: leRx,
          reSummary,
          leSummary,
          be: isSameEye ? reRx : null,
          isSameEyePower: isSameEye,
          raw: {
            re: { sph: rightSph, cyl: rightCyl, axis: rightAxis, add: rightAdd },
            le: { sph: leftSph, cyl: leftCyl, axis: leftAxis, add: leftAdd },
          },
        },
        pairedFrame: frameData
          ? {
              name: frameData.houseName || frameData.name,
              companyName: frameData.companyName,
              frameCode: frameData.frameCode,
            }
          : ctx?.pairedFrameName
          ? {
              name: ctx.pairedFrameName,
              companyName: '',
              frameCode: ctx.pairedFrameCode || '',
            }
          : item.frameVariantLabel
          ? {
              name: item.frameVariantLabel,
              companyName: '',
              frameCode: '',
            }
          : null,
        _ctx: ctx || fallbackCtx,
      };
    });

    res.json({ count: enriched.length, items: enriched });
  } catch (error) {
    next(error);
  }
};

// ── GET /api/wholesaler-queue/summary ─────────────────────────────────────────
// Generates the daily 7:00–7:30 PM wholesaler reconciliation summary
export const getDailyWholesalerSummary = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const targetDateStr = (req.query.date as string) || new Date().toISOString().slice(0, 10);
    const startOfDay = new Date(targetDateStr);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(targetDateStr);
    endOfDay.setHours(23, 59, 59, 999);

    // Find all lens items created or dispatched today
    const items = await InvoiceItem.find({
      $or: [
        { createdAt: { $gte: startOfDay, $lte: endOfDay } },
        { wholesalerOrderDate: { $gte: startOfDay, $lte: endOfDay } },
        { fulfillmentSource: 'ordered', sentToWholesaler: { $ne: true } },
      ],
      $and: [
        {
          $or: [
            { lensType: { $exists: true, $ne: null } },
            { opticalLens: { $exists: true, $ne: null } },
            { fulfillmentSource: 'ordered' },
          ],
        },
      ],
    })
      .populate('frame', 'name companyName houseName frameCode')
      .populate('opticalLens', 'name brand category coating index')
      .sort({ createdAt: 1 })
      .lean();

    // Map invoices for frame context and invoice numbers (strictly no customer personal details sent to wholesaler)
    const itemIds = items.map((i) => i._id);
    const invoices = await Invoice.find({ items: { $in: itemIds } })
      .populate({
        path: 'items',
        populate: { path: 'frame', select: 'name companyName houseName frameCode' },
      })
      .lean();

    const itemCtx = new Map<string, any>();
    for (const inv of invoices) {
      const invItems = (inv.items as any[]) || [];
      const frameItem = invItems.find((it) => it.frame || it.type === 'frame');
      const frameObj = frameItem?.frame as any;
      const frameName = frameObj?.houseName || frameObj?.name || frameItem?.lensBrand || null;
      const frameCode = frameObj?.frameCode || null;

      for (const itemRef of inv.items) {
        const key = (itemRef._id || itemRef).toString();
        if (!itemCtx.has(key)) {
          itemCtx.set(key, {
            invoiceId: (inv._id as mongoose.Types.ObjectId).toString(),
            invoiceNumber: inv.invoiceNumber ?? 'N/A',
            frameName,
            frameCode,
          });
        }
      }
    }

    let totalPairs = 0;
    let totalLenses = 0;
    const lensTypeCounts: Record<string, number> = {};
    const coatingCounts: Record<string, number> = {};

    const summaryItems = items.map((item: any, idx: number) => {
      const qty = item.quantity || 1;
      const eye = item.eye || 'both';
      const pairQty = eye === 'left' || eye === 'right' ? qty * 0.5 : qty;
      totalPairs += pairQty;
      const numLenses = eye === 'both' ? qty * 2 : qty;
      totalLenses += numLenses;

      const typeKey = item.lensType || item.lensCategory || item.opticalLens?.category || 'Single Vision';
      lensTypeCounts[typeKey] = (lensTypeCounts[typeKey] || 0) + pairQty;

      const coatingKey = item.lensCoating || item.opticalLens?.coating || 'White / Hard Coat';
      coatingCounts[coatingKey] = (coatingCounts[coatingKey] || 0) + pairQty;

      const rightSph = item.rightSpherical ?? item.spherical ?? null;
      const rightCyl = item.rightCylinder ?? item.cylinder ?? null;
      const rightAxis = item.rightAxis ?? item.axis ?? null;
      const rightAdd = item.rightAddition ?? item.addition ?? null;

      const leftSph = item.leftSpherical ?? (item.isSameNumber ? rightSph : null);
      const leftCyl = item.leftCylinder ?? (item.isSameNumber ? rightCyl : null);
      const leftAxis = item.leftAxis ?? (item.isSameNumber ? rightAxis : null);
      const leftAdd = item.leftAddition ?? (item.isSameNumber ? rightAdd : null);

      const ctx = itemCtx.get((item._id as mongoose.Types.ObjectId).toString());
      const frameName = item.frame?.houseName || item.frame?.name || ctx?.frameName || item.frameVariantLabel || 'Customer Own Frame';
      const frameCode = item.frame?.frameCode || ctx?.frameCode || '';

      const material = item.lensMaterial || (item.opticalLens?.category ? 'Fiber' : 'CR-39');
      const lensCompany = item.lensCompany || item.lensBrand || item.opticalLens?.brand || '';
      const color = item.lensColor || '';
      const lensIndex = item.lensIndex || item.opticalLens?.index || '';

      const reFormatted = formatEyePower(rightSph, rightCyl, rightAxis, rightAdd);
      const leFormatted = formatEyePower(leftSph, leftCyl, leftAxis, leftAdd);
      const isSameEyePower = reFormatted === leFormatted;

      const reSummary = formatEyeSummaryPower(rightSph, rightCyl, rightAxis, rightAdd);
      const leSummary = formatEyeSummaryPower(leftSph, leftCyl, leftAxis, leftAdd);
      const compactSpecs = formatCompactLensSpecs(item);

      return {
        jobNo: idx + 1,
        itemId: (item._id as mongoose.Types.ObjectId).toString(),
        invoiceNumber: ctx?.invoiceNumber || 'Direct Order',
        frameName,
        frameCode,
        lensCompany,
        lensType: typeKey,
        material,
        coating: coatingKey,
        color,
        lensIndex,
        quantity: qty,
        pairQuantity: pairQty,
        eye,
        numLenses,
        re: reFormatted,
        le: leFormatted,
        reSummary,
        leSummary,
        compactSpecs,
        isSameEyePower,
        be: isSameEyePower ? reFormatted : null,
        sentToWholesaler: !!item.sentToWholesaler,
        labStatus: item.labStatus || (item.sentToWholesaler ? 'sent' : 'pending'),
      };
    });

    res.json({
      date: targetDateStr,
      totalJobs: summaryItems.length,
      totalPairs,
      totalLenses,
      breakdown: {
        byType: lensTypeCounts,
        byCoating: coatingCounts,
      },
      items: summaryItems,
    });
  } catch (error) {
    next(error);
  }
};

// ── POST /api/wholesaler-queue/direct-order ──────────────────────────────────
// Allows logging a custom customer lens directly into the wholesale lab queue without an invoice
export const createDirectLabOrder = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const {
      customerName,
      customerPhone,
      frameName,
      frameCode,
      lensType,
      lensCompany,
      lensMaterial,
      lensCoating,
      lensColor,
      lensIndex,
      eye,
      quantity,
      price,
      notes,
      rightSpherical,
      rightCylinder,
      rightAxis,
      rightAddition,
      leftSpherical,
      leftCylinder,
      leftAxis,
      leftAddition,
      isSameNumber,
    } = req.body;

    const frameLabel = frameName
      ? frameCode
        ? `${frameName} (${frameCode})`
        : frameName
      : undefined;

    const itemDoc = new InvoiceItem({
      userName: customerName?.trim() || 'Walk-in Client',
      lensType: lensType || 'Single Vision',
      lensCompany: lensCompany || 'Local',
      lensMaterial: lensMaterial || 'Fiber',
      lensCoating: lensCoating || 'Hard Coat',
      lensColor: lensColor || 'White',
      lensIndex: lensIndex || '',
      frameVariantLabel: frameLabel,
      eye: eye || 'both',
      quantity: typeof quantity === 'number' && quantity > 0 ? quantity : 1,
      price: typeof price === 'number' ? price : 0,
      lensLabel: notes?.trim() || (customerPhone ? `Phone: ${customerPhone}` : undefined),
      isCustomLens: true,
      isSameNumber: !!isSameNumber,
      fulfillmentSource: 'ordered',
      sentToWholesaler: false,
      labStatus: 'pending',
      rightSpherical: rightSpherical !== undefined && rightSpherical !== '' ? Number(rightSpherical) : null,
      rightCylinder: rightCylinder !== undefined && rightCylinder !== '' ? Number(rightCylinder) : null,
      rightAxis: rightAxis !== undefined && rightAxis !== '' ? Number(rightAxis) : null,
      rightAddition: rightAddition !== undefined && rightAddition !== '' ? Number(rightAddition) : null,
      leftSpherical: isSameNumber
        ? (rightSpherical !== undefined && rightSpherical !== '' ? Number(rightSpherical) : null)
        : (leftSpherical !== undefined && leftSpherical !== '' ? Number(leftSpherical) : null),
      leftCylinder: isSameNumber
        ? (rightCylinder !== undefined && rightCylinder !== '' ? Number(rightCylinder) : null)
        : (leftCylinder !== undefined && leftCylinder !== '' ? Number(leftCylinder) : null),
      leftAxis: isSameNumber
        ? (rightAxis !== undefined && rightAxis !== '' ? Number(rightAxis) : null)
        : (leftAxis !== undefined && leftAxis !== '' ? Number(leftAxis) : null),
      leftAddition: isSameNumber
        ? (rightAddition !== undefined && rightAddition !== '' ? Number(rightAddition) : null)
        : (leftAddition !== undefined && leftAddition !== '' ? Number(leftAddition) : null),
    });

    await itemDoc.save();

    res.status(201).json({
      message: 'Direct customer lab order logged successfully',
      item: itemDoc,
    });
  } catch (error) {
    next(error);
  }
};

// ── POST /api/wholesaler-queue/send ──────────────────────────────────────────
export const markSentToWholesaler = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { ids } = req.body as { ids?: unknown };

    if (!Array.isArray(ids) || ids.length === 0 || !ids.every((id) => typeof id === 'string')) {
      res.status(400).json({ message: 'ids must be a non-empty array of strings.' });
      return;
    }

    const objectIds = ids.map((id) => new mongoose.Types.ObjectId(id as string));

    const items = await InvoiceItem.find({
      _id: { $in: objectIds },
    }).lean();

    if (items.length === 0) {
      res.status(404).json({ message: 'No items found matching the given IDs.' });
      return;
    }

    const now = new Date();
    const pendingEntries: object[] = [];

    for (const item of items) {
      const eye = item.eye as string | null | undefined;
      const skuBase = {
        status: 'pending' as const,
        qty: item.quantity,
        notes: item.lensLabel ?? item.lensName ?? null,
        lensType: item.lensType ?? null,
        material: item.lensMaterial ?? null,
        coating: item.lensCoating ?? null,
        color: item.lensColor ?? null,
        purchaseDate: now,
        wholesalerOrderDate: now,
      };

      const rightSph = item.rightSpherical ?? item.spherical ?? null;
      const leftSph = item.leftSpherical ?? (item.isSameNumber ? rightSph : null);

      if ((eye === 'both' || !eye) && rightSph !== null && leftSph !== null) {
        pendingEntries.push({
          ...skuBase,
          sph: rightSph,
          cyl: item.rightCylinder ?? item.cylinder ?? 0,
          add: item.rightAddition ?? item.addition ?? null,
          eye: 'right',
        });
        pendingEntries.push({
          ...skuBase,
          sph: leftSph,
          cyl: item.leftCylinder ?? (item.isSameNumber ? item.rightCylinder ?? 0 : 0),
          add: item.leftAddition ?? (item.isSameNumber ? item.rightAddition ?? null : null),
          eye: 'left',
        });
      } else {
        const sph = rightSph ?? leftSph ?? null;
        const cyl = item.rightCylinder ?? item.leftCylinder ?? item.cylinder ?? 0;
        const add = item.rightAddition ?? item.leftAddition ?? item.addition ?? null;

        pendingEntries.push({
          ...skuBase,
          sph,
          cyl,
          add,
          eye: eye ?? 'both',
        });
      }
    }

    const session = await mongoose.startSession();
    try {
      session.startTransaction();

      await InvoiceItem.updateMany(
        { _id: { $in: objectIds } },
        {
          $set: {
            sentToWholesaler: true,
            wholesalerOrderDate: now,
            labStatus: 'sent',
          },
        },
        { session },
      );

      if (pendingEntries.length > 0) {
        await PurchaseEntry.insertMany(pendingEntries, { session });
      }

      await session.commitTransaction();
    } catch (txError) {
      await session.abortTransaction();
      throw txError;
    } finally {
      session.endSession();
    }

    res.json({ count: objectIds.length, sentAt: now });
  } catch (error) {
    next(error);
  }
};

// ── PATCH /api/wholesaler-queue/status ─────────────────────────────────────────
// Updates labStatus to 'received', 'fitted', or 'cancelled'
export const updateLabOrderStatus = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { ids, status } = req.body as { ids?: string[]; status?: string };

    if (!Array.isArray(ids) || ids.length === 0 || !status) {
      res.status(400).json({ message: 'ids array and status are required.' });
      return;
    }

    if (!['pending', 'sent', 'received', 'fitted', 'cancelled'].includes(status)) {
      res.status(400).json({ message: 'Invalid status value.' });
      return;
    }

    const objectIds = ids.map((id) => new mongoose.Types.ObjectId(id));
    const now = new Date();
    const updateDoc: Record<string, any> = { labStatus: status };

    if (status === 'received') {
      updateDoc.labReceivedDate = now;
      // Mark linked PurchaseEntry as received
      await PurchaseEntry.updateMany(
        { status: 'pending' },
        { $set: { status: 'received' } },
      );
    } else if (status === 'fitted') {
      updateDoc.labFittedDate = now;
      updateDoc.fulfillmentSource = 'stock';
    } else if (status === 'sent') {
      updateDoc.sentToWholesaler = true;
      updateDoc.wholesalerOrderDate = now;
    }

    await InvoiceItem.updateMany(
      { _id: { $in: objectIds } },
      { $set: updateDoc },
    );

    res.json({ updatedCount: objectIds.length, status, updatedAt: now });
  } catch (error) {
    next(error);
  }
};

// ── DELETE /api/wholesaler-queue/:id or DELETE /api/wholesaler-queue ──────────
export const deleteLabOrder = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const id = req.params.id || (req.body as any)?.id;
    const ids: string[] = req.body?.ids || (id ? [id] : []);

    if (ids.length === 0) {
      res.status(400).json({ message: 'Item ID or ids array is required.' });
      return;
    }

    const objectIds = ids.map((i) => new mongoose.Types.ObjectId(i));

    // Find if any invoices reference these items
    const linkedInvoices = await Invoice.find({ items: { $in: objectIds } }).lean();
    const linkedItemIds = new Set<string>();
    for (const inv of linkedInvoices) {
      for (const itemRef of inv.items) {
        linkedItemIds.add((itemRef._id || itemRef).toString());
      }
    }

    // Direct items (not on any invoice) can be safely deleted
    const directIds = objectIds.filter((objId) => !linkedItemIds.has(objId.toString()));
    // Invoiced items get cancelled / removed from wholesale queue
    const invoicedIds = objectIds.filter((objId) => linkedItemIds.has(objId.toString()));

    if (directIds.length > 0) {
      await InvoiceItem.deleteMany({ _id: { $in: directIds } });
    }

    if (invoicedIds.length > 0) {
      await InvoiceItem.updateMany(
        { _id: { $in: invoicedIds } },
        {
          $set: {
            labStatus: 'cancelled',
            fulfillmentSource: 'stock',
            sentToWholesaler: false,
          },
        },
      );
    }

    res.json({
      success: true,
      deletedCount: directIds.length,
      cancelledCount: invoicedIds.length,
      total: ids.length,
    });
  } catch (error) {
    next(error);
  }
};

// ── PATCH /api/wholesaler-queue/item/:id ──────────────────────────────────────
// Updates item details like lensType, lensMaterial, lensCoating, lensColor, lensCompany, or quantity
export const updateLabOrderItem = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { id } = req.params;
    const { lensType, lensMaterial, lensCoating, lensColor, lensCompany, quantity } = req.body;

    const item = await InvoiceItem.findById(id);
    if (!item) {
      res.status(404).json({ message: 'Lab order item not found' });
      return;
    }

    if (lensType !== undefined) item.lensType = lensType;
    if (lensMaterial !== undefined) item.lensMaterial = lensMaterial;
    if (lensCoating !== undefined) item.lensCoating = lensCoating;
    if (lensColor !== undefined) item.lensColor = lensColor;
    if (lensCompany !== undefined) item.lensCompany = lensCompany;
    if (quantity !== undefined && typeof quantity === 'number' && quantity > 0) {
      item.quantity = quantity;
    }

    await item.save();

    res.json({ success: true, item });
  } catch (error) {
    next(error);
  }
};
