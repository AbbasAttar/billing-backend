import { createFirestoreModel, BaseDoc } from '../lib/firestoreModel';

/**
 * Customer feedback from the online bill page (aoh-website /bill/[id]). One document per invoice,
 * keyed by the invoice id, so the page reads and writes it directly. The timestamps double as the
 * review funnel: bill opened → prompt shown → rated → Google review link clicked.
 */
export interface IBillFeedback extends BaseDoc {
  invoice: string;
  invoiceNumber?: string;
  customer?: string;
  customerName?: string;
  billDate?: Date;
  /** 1–5 stars. */
  rating?: number;
  /** What could be improved (any rating may add one; the page asks for it on 1–3 stars). */
  comment?: string;
  /** Google-review drafts written for this bill (latest last); also caps AI calls per bill. */
  reviewDrafts?: string[];
  openCount?: number;
  firstOpenedAt?: Date;
  lastOpenedAt?: Date;
  promptShownAt?: Date;
  dismissedAt?: Date;
  ratedAt?: Date;
  googleClickedAt?: Date;
  /** Staff marked a low rating as followed up. */
  resolvedAt?: Date;
  createdAt?: Date;
  updatedAt?: Date;
}

export const BillFeedback = createFirestoreModel<IBillFeedback>('billfeedback', { mirror: true });
