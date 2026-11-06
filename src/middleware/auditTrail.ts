import { Request, Response, NextFunction } from 'express';
import { AuditLog } from '../models/AuditLog.model';
import { Invoice } from '../models/Invoice.model';
import { InvoiceItem } from '../models/InvoiceItem.model';
import { Customer } from '../models/Customer.model';
import { Frame } from '../models/Frame.model';
import { Fragrance } from '../models/Fragrance.model';
import { OpticalLens } from '../models/OpticalLens.model';
import { Prescription } from '../models/Prescription.model';
import { WholesaleItem } from '../models/WholesaleItem.model';
import { ContactLens } from '../models/ContactLens.model';
import {
  areaOf,
  describe,
  invoiceIdOf,
  pickResponse,
  redactBody,
  shouldAudit,
  targetIdOf,
  type InvoiceBefore,
} from '../services/auditTrail';

/** Cleaned body as a JSON string (any key is safe, and Firestore does not index each field). */
const bodyJson = (body: unknown): string | undefined => {
  const clean = redactBody(body);
  return clean === undefined ? undefined : JSON.stringify(clean);
};

const idOf = (v: unknown): string | undefined =>
  v && typeof v === 'object' ? String((v as any)._id ?? (v as any).id) : v ? String(v) : undefined;

/** Areas whose record is read before an edit / delete, so the log can show before → after. */
const AREA_MODEL: Record<string, { findById: (id: string) => { lean: () => PromiseLike<unknown> } }> = {
  customers: Customer as any,
  frames: Frame as any,
  fragrances: Fragrance as any,
  'optical-lenses': OpticalLens as any,
  prescriptions: Prescription as any,
  'wholesale-items': WholesaleItem as any,
  'contact-lenses': ContactLens as any,
};

const RECORD_ID = /^[A-Za-z0-9_-]{12,}$/;

/** The stored record an update / delete is about (bill line for /invoices/:id/items/:itemId). */
async function readRecordBefore(method: string, path: string): Promise<Record<string, unknown> | null> {
  if (method === 'POST') return null;
  const parts = path.split('/').filter(Boolean);
  try {
    if (parts[0] === 'invoices' && parts[2] === 'items' && method === 'PUT' && RECORD_ID.test(parts[3] ?? '')) {
      return ((await InvoiceItem.findById(parts[3]).lean()) as Record<string, unknown> | null) ?? null;
    }
    const model = AREA_MODEL[parts[0] ?? ''];
    if (!model || !RECORD_ID.test(parts[1] ?? '')) return null;
    return ((await model.findById(parts[1]).lean()) as Record<string, unknown> | null) ?? null;
  } catch {
    return null;
  }
}

async function readInvoiceBefore(id: string): Promise<InvoiceBefore | null> {
  try {
    const inv = (await Invoice.findById(id).lean()) as any;
    if (!inv) return null;
    const billDate = inv.billDate ? new Date(inv.billDate) : null;
    return {
      invoiceNumber: inv.invoiceNumber,
      discount: inv.discount ?? 0,
      subtotal: inv.subtotal,
      total: inv.total,
      customer: idOf(inv.customer),
      billDate: billDate && !Number.isNaN(billDate.getTime()) ? billDate.toISOString() : undefined,
      payments: (inv.payments ?? []).map((p: any) => ({ amount: p.amount ?? 0, method: p.method, ...(p.writeoff ? { writeoff: p.writeoff } : {}) })),
      items: (inv.items ?? []).length,
    };
  } catch {
    return null;
  }
}

/**
 * Records every write to the admin/POS API: who (signed-in email and role), what (a readable
 * summary, what was entered, before → after for edits, the cleaned body), when (server time), and
 * whether it worked. The app never edits or deletes entries (Firestore TTL removes them after two
 * years). Mounted after authorizeByPolicy, so req.user is known. A failed log write never affects
 * the request.
 */
export async function auditTrail(req: Request, res: Response, next: NextFunction) {
  if (!shouldAudit(req.method, req.path)) return next();

  const started = Date.now();
  const path = req.path.replace(/\/+$/, '') || '/';
  const invoiceId = invoiceIdOf(path);
  const method = req.method.toUpperCase();
  const [before, beforeDoc] = await Promise.all([
    invoiceId ? readInvoiceBefore(invoiceId) : Promise.resolve(null),
    readRecordBefore(method, path),
  ]);

  let response: Record<string, unknown> | null = null;
  const json = res.json.bind(res);
  res.json = (payload: unknown) => {
    response = pickResponse(payload);
    return json(payload);
  };

  res.on('finish', () => {
    const described = describe({ method, path, status: res.statusCode, body: req.body, response, before, beforeDoc });
    const body = bodyJson(req.body);
    const entry = {
      at: new Date(started),
      // Who, as they were at the time (name snapshot survives later account changes).
      ...(req.user ? { email: req.user.email, uid: req.user.uid, role: req.user.role, ...(req.user.name ? { name: req.user.name } : {}) } : {}),
      method,
      path,
      area: areaOf(path),
      targetId: invoiceId ?? targetIdOf(path, response),
      status: res.statusCode,
      ...described,
      ...(body ? { body } : {}),
      ...(before ? { before } : {}),
      durationMs: Date.now() - started,
    };
    Promise.resolve(AuditLog.create(entry)).catch((err: unknown) => {
      console.warn('[AUDIT] could not write entry:', (err as Error)?.message ?? err);
    });
  });

  next();
}
