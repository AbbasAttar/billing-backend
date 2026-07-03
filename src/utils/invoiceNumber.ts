import { InvoiceCounter } from '../models/InvoiceCounter.model';

/** Returns "26-27" style string for any given date (India FY: Apr–Mar). */
export function financialYear(date: Date): string {
  const m = date.getMonth(); // 0-indexed; April = 3
  const y = date.getFullYear();
  const start = m >= 3 ? y : y - 1;
  return `${String(start).slice(-2)}-${String(start + 1).slice(-2)}`;
}

/** Formats a sequence + FY into "INV0001/26-27". */
export function formatInvoiceNo(seq: number, fy: string): string {
  return `INV${String(seq).padStart(4, '0')}/${fy}`;
}

/** Atomically increments the counter for the given FY and returns the next seq. */
export async function nextSequence(fy: string): Promise<number> {
  const counter = await InvoiceCounter.findOneAndUpdate(
    { year: fy },
    { $inc: { lastSeq: 1 } },
    { new: true, upsert: true }
  );
  return counter.lastSeq;
}

/** Generates and returns the next invoice number for a given billDate. */
export async function generateInvoiceNumber(billDate: Date): Promise<string> {
  const fy  = financialYear(billDate);
  const seq = await nextSequence(fy);
  return formatInvoiceNo(seq, fy);
}
