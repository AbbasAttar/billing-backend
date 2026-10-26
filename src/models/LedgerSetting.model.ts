import { createFirestoreModel, BaseDoc } from '../lib/firestoreModel';
import { VendorCategory } from './VendorAccount.model';

/** Owner settings for vendor planning; a single document. */
export interface ILedgerSetting extends BaseDoc {
  /** share of collections set aside for vendors (bills + clearing dues), in % */
  vendorSharePct: number;
  /** most to buy per category per month, to avoid overstocking one category; 0 = no cap */
  purchaseCaps: Record<VendorCategory, number>;
  /** fixed amount put toward old vendor dues every month; unused cap money is added on top */
  repaymentBudget: number;
  /** when the repayment plan was first saved; this month's tracking ignores entries made before it */
  planStartedAt?: Date;
  /**
   * Owner's own payment schedule, one row per planned payment. A list, not a month → vendor map:
   * Firestore merge-writes keep map keys, so a cleared cell would come back.
   */
  schedule?: { month: string; vendorId: string; amount: number }[];
  createdAt?: Date;
  updatedAt?: Date;
}

export const DEFAULT_LEDGER_SETTING = {
  vendorSharePct: 40,
  repaymentBudget: 0,
  purchaseCaps: { fragrance: 0, lens: 0, frame: 0, other: 0 },
};

export const LedgerSetting = createFirestoreModel<ILedgerSetting>('ledgersettings');
