import { Request, Response, NextFunction } from 'express';
import mongoose from 'mongoose';
import { InvoiceItem } from '../models/InvoiceItem.model';
import { Invoice } from '../models/Invoice.model';
import { PurchaseEntry } from '../models/PurchaseEntry.model';

// ── GET /api/wholesaler-queue ─────────────────────────────────────────────────

export const getPendingOrderItems = async (
  _req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    // All InvoiceItems that are ordered but not yet sent
    const items = await InvoiceItem.find({
      fulfillmentSource: 'ordered',
      sentToWholesaler: { $ne: true },
    }).sort({ createdAt: 1 }).lean();

    if (items.length === 0) {
      res.json({ count: 0, items: [] });
      return;
    }

    // Reverse-lookup: find invoices that reference these items
    const itemIds = items.map((i) => i._id);
    const invoices = await Invoice.find({ items: { $in: itemIds } })
      .populate<{ customer: { _id: mongoose.Types.ObjectId; name: string; mobileNumber: string } }>(
        'customer', 'name mobileNumber',
      )
      .lean();

    // Build map: itemId (string) -> { invoiceNumber, invoiceId, customer }
    const itemCtx = new Map<
      string,
      { invoiceNumber: string | null; invoiceId: string; customerName: string; customerPhone: string }
    >();
    for (const inv of invoices) {
      const cust = inv.customer as { name?: string; mobileNumber?: string } | null;
      for (const itemRef of inv.items) {
        const key = itemRef.toString();
        if (!itemCtx.has(key)) {
          itemCtx.set(key, {
            invoiceId:     (inv._id as mongoose.Types.ObjectId).toString(),
            invoiceNumber: inv.invoiceNumber ?? null,
            customerName:  cust?.name        ?? 'Unknown',
            customerPhone: cust?.mobileNumber ?? '',
          });
        }
      }
    }

    const enriched = items.map((item) => ({
      ...item,
      _ctx: itemCtx.get((item._id as mongoose.Types.ObjectId).toString()) ?? null,
    }));

    res.json({ count: enriched.length, items: enriched });
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

    // Fetch items first to validate eligibility and collect SKU data
    const items = await InvoiceItem.find({
      _id: { $in: objectIds },
      fulfillmentSource: 'ordered',
    }).lean();

    if (items.length !== objectIds.length) {
      const foundIds = new Set(items.map((i) => (i._id as mongoose.Types.ObjectId).toString()));
      const missing = ids.filter((id) => !foundIds.has(id as string));
      res.status(400).json({
        message: `${missing.length} item(s) not found or not fulfillmentSource='ordered': ${missing.join(', ')}`,
      });
      return;
    }

    const alreadySent = items.filter((i) => i.sentToWholesaler);
    if (alreadySent.length > 0) {
      res.status(400).json({
        message: `${alreadySent.length} item(s) already sent to wholesaler.`,
        ids: alreadySent.map((i) => (i._id as mongoose.Types.ObjectId).toString()),
      });
      return;
    }

    const now = new Date();

    // Build pending PurchaseEntry docs from InvoiceItem SKU fields
    const pendingEntries: object[] = [];
    for (const item of items) {
      const eye = item.eye as string | null | undefined;
      const skuBase = {
        status:             'pending' as const,
        qty:                 item.quantity,
        notes:               item.lensLabel ?? item.lensName ?? null,
        lensType:            item.lensType    ?? null,
        material:            item.lensMaterial ?? null,
        coating:             item.lensCoating  ?? null,
        color:               item.lensColor    ?? null,
        purchaseDate:        now,
        wholesalerOrderDate: now,
      };

      const rightSph = item.rightSpherical ?? item.spherical ?? null;
      const leftSph  = item.leftSpherical  ?? null;

      if ((eye === 'both' || !eye) && rightSph !== null && leftSph !== null) {
        // Both eyes have distinct Rx — create one entry per eye
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
          cyl: item.leftCylinder ?? 0,
          add: item.leftAddition ?? null,
          eye: 'left',
        });
      } else {
        // Single entry — resolve Rx from the named eye
        let sph: number | null = null;
        let cyl: number | null = null;
        let add: number | null = null;

        if (eye === 'right') {
          sph = rightSph;
          cyl = item.rightCylinder ?? item.cylinder ?? null;
          add = item.rightAddition ?? item.addition ?? null;
        } else if (eye === 'left') {
          sph = leftSph;
          cyl = item.leftCylinder ?? null;
          add = item.leftAddition ?? null;
        } else {
          // both/unset with incomplete Rx (one eye missing)
          sph = rightSph;
          cyl = item.rightCylinder ?? item.cylinder ?? null;
          add = item.rightAddition ?? item.addition ?? null;
        }

        pendingEntries.push({
          ...skuBase,
          sph,
          cyl: cyl ?? 0,
          add,
          eye: eye ?? 'both',
        });
      }
    }

    // Atomic: update items + create pending purchase entries in a session
    const session = await mongoose.startSession();
    try {
      session.startTransaction();

      await InvoiceItem.updateMany(
        { _id: { $in: objectIds } },
        { $set: { sentToWholesaler: true, wholesalerOrderDate: now } },
        { session },
      );

      await PurchaseEntry.insertMany(pendingEntries, { session });

      await session.commitTransaction();
    } catch (txError) {
      await session.abortTransaction();
      throw txError;
    } finally {
      session.endSession();
    }

    res.json({ count: ids.length, sentAt: now });
  } catch (error) {
    next(error);
  }
};
