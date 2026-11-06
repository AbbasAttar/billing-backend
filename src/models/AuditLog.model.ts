import { createFirestoreModel, BaseDoc, expireAfterDays } from '../lib/firestoreModel';
import type { AuditCategory, AuditChange, AuditFact, AuditFlag, AuditKind, AuditRef, InvoiceBefore } from '../services/auditTrail';

/** One write made through the admin/POS API (see middleware/auditTrail.ts). */
export interface IAuditLog extends BaseDoc {
  at: Date;
  email?: string;
  /** Google display name at the time of the change. */
  name?: string;
  uid?: string;
  role?: string;
  method: string;
  /** Path inside the admin API, e.g. /invoices/abc/payment. */
  path: string;
  area: string;
  targetId?: string;
  status: number;
  summary: string;
  flags: AuditFlag[];
  /** Quick-read parts (entries written before they were added have only `summary`). */
  kind?: AuditKind;
  action?: string;
  subject?: string;
  amount?: number;
  details?: string[];
  category?: AuditCategory;
  badge?: string;
  primary?: { label: string; value: string };
  secondary?: string;
  reference?: AuditRef;
  chips?: string[];
  facts?: AuditFact[];
  changes?: AuditChange[];
  /** Request body as JSON, secrets removed and long values cut. */
  body?: string;
  /** Bill state read just before an invoice change. */
  before?: InvoiceBefore;
  durationMs?: number;
  /** TTL: Firestore deletes the entry after this time. */
  expireAt?: Date;
}

/** Firestore TTL deletes audit entries after two years (see firestore.indexes.json). */
export const AUDIT_LOG_TTL_DAYS = 730;

export const AuditLog = createFirestoreModel<IAuditLog>('auditlogs', {
  beforeWrite: (payload, ctx) => {
    if (ctx.full && !payload.expireAt) payload.expireAt = expireAfterDays(payload.at, AUDIT_LOG_TTL_DAYS);
  },
});
