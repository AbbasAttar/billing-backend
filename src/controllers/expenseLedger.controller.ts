import { NextFunction, Request, Response } from 'express';
import {
  ExpenseLog,
  EXPENSE_LOG_CATEGORIES,
  EXPENSE_LOG_METHODS,
  ExpenseLogCategory,
  ExpenseLogMethod,
  IExpenseLog,
} from '../models/ExpenseLog.model';
import { RecurringBill, RECURRING_KINDS, BILL_SCOPES, BillScope, IRecurringBill, RecurringPart } from '../models/RecurringBill.model';
import { VendorAccount, VendorTxn, VENDOR_TXN_TYPES, VendorTxnType, VENDOR_CATEGORIES } from '../models/VendorAccount.model';
import { LedgerSetting, DEFAULT_LEDGER_SETTING } from '../models/LedgerSetting.model';
import {
  money,
  applyRecurringPayment,
  reverseRecurringPayment,
  resetRecurring,
  vendorBalanceDelta,
  RecurringState,
  vendorCategorySummary,
  repaymentProgress,
  isMonthKey,
  paidByMonth,
  isDayKey,
  buildRepaymentSchedule,
  chequesByMonth,
  addMonthKey,
  monthKeyOf,
  isPaymentStep,
  PAYMENT_STEP,
} from '../services/expenseLedger';
import { DailySaving } from '../models/DailySaving.model';
import { Cheque, ChequeStatus, ICheque, PLANNED_METHODS, PlannedMethod } from '../models/Cheque.model';
import { fail, ok } from '../utils/response';

const parseDate = (value?: string): Date | null => {
  if (!value) return new Date();
  const dt = new Date(value);
  return Number.isNaN(dt.getTime()) ? null : dt;
};
const isCategory = (v: unknown): v is ExpenseLogCategory => EXPENSE_LOG_CATEGORIES.includes(v as ExpenseLogCategory);
const isMethod = (v: unknown): v is ExpenseLogMethod => EXPENSE_LOG_METHODS.includes(v as ExpenseLogMethod);
const isAmount = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0;

const recurringState = (b: IRecurringBill): RecurringState => ({
  kind: b.kind,
  amount: b.amount,
  totalInstallments: b.totalInstallments,
  paidInstallments: b.paidInstallments ?? 0,
  dueRemaining: b.dueRemaining ?? 0,
  cycle: b.cycle ?? 1,
  status: b.status ?? 'active',
  parts: b.parts?.length ? b.parts : undefined,
});

const METHOD_LABEL: Record<ExpenseLogMethod, string> = { cash: 'Cash', upi: 'UPI', card: 'Card', bank_transfer: 'Bank', cheque: 'Cheque' };

/** A cleared cheque whose expense entry went away is a planned payment again. */
const releaseCheque = async (expenseLogId?: string) => {
  if (!expenseLogId) return;
  const cheque = await Cheque.findOne({ expenseLogId });
  if (cheque)
    await Cheque.findByIdAndUpdate(cheque._id, { $set: { status: 'pending' }, $unset: { expenseLogId: '', clearedOn: '' } });
};

/** Validates split parts from the request; null when none were sent, a string on error. */
const parseParts = (raw: unknown): RecurringPart[] | null | string => {
  if (raw === undefined || raw === null || (Array.isArray(raw) && raw.length === 0)) return null;
  if (!Array.isArray(raw)) return 'parts must be a list';
  const parts: RecurringPart[] = [];
  for (const p of raw as Array<Record<string, unknown>>) {
    if (!isAmount(p?.amount)) return 'Each part needs an amount greater than 0';
    if (!isMethod(p?.method)) return 'Each part needs a payment method';
    const label = typeof p.label === 'string' && p.label.trim() ? p.label.trim() : METHOD_LABEL[p.method];
    parts.push({ label, method: p.method, amount: money(p.amount), due: money(p.amount) });
  }
  return parts;
};

// ─── Expense log ─────────────────────────────────────────────────────────────

export const listExpenseLogs = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { startDate, endDate, category } = req.query as Record<string, string | undefined>;
    const filter: Record<string, unknown> = {};
    if (startDate || endDate) {
      const start = startDate ? parseDate(startDate) : null;
      const end = endDate ? parseDate(endDate) : null;
      if ((startDate && !start) || (endDate && !end)) return fail(res, 'Invalid date range', 400);
      filter.date = { ...(start ? { $gte: start } : {}), ...(end ? { $lte: end } : {}) };
    }
    if (category) {
      if (!isCategory(category)) return fail(res, 'Invalid category', 400);
      filter.category = category;
    }
    const logs = await ExpenseLog.find(filter).sort({ date: -1 });
    return ok(res, logs);
  } catch (error) {
    next(error);
  }
};

export const createExpenseLog = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { date, category, amount, note, paymentMethod } = req.body ?? {};
    if (!isAmount(amount)) return fail(res, 'amount must be greater than 0', 400);
    if (!isCategory(category)) return fail(res, `category must be one of: ${EXPENSE_LOG_CATEGORIES.join(', ')}`, 400);
    const method = paymentMethod ?? 'cash';
    if (!isMethod(method)) return fail(res, 'Invalid paymentMethod', 400);
    const parsed = parseDate(date);
    if (!parsed) return fail(res, 'Invalid date', 400);

    const log = await ExpenseLog.create({ date: parsed, category, amount: money(amount), note, paymentMethod: method });
    return ok(res, log, 'Expense logged', 201);
  } catch (error) {
    next(error);
  }
};

export const updateExpenseLog = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const log = await ExpenseLog.findById(req.params.id);
    if (!log) return fail(res, 'Expense not found', 404);
    const { date, category, amount, note, paymentMethod } = req.body ?? {};

    // Payments from a bill or vendor keep their amount and category; delete and re-pay to change them.
    if (log.source && ((amount !== undefined && amount !== log.amount) || (category !== undefined && category !== log.category)))
      return fail(res, `This entry is a ${log.source.kind} payment. Delete it and pay again to change the amount.`, 400);
    if (log.chequeId && amount !== undefined && amount !== log.amount)
      return fail(res, 'This entry is a cleared cheque. Mark the cheque bounced to undo it instead.', 400);

    const update: Partial<IExpenseLog> = {};
    if (amount !== undefined) {
      if (!isAmount(amount)) return fail(res, 'amount must be greater than 0', 400);
      update.amount = money(amount);
    }
    if (category !== undefined) {
      if (!isCategory(category)) return fail(res, 'Invalid category', 400);
      update.category = category;
    }
    if (paymentMethod !== undefined) {
      if (!isMethod(paymentMethod)) return fail(res, 'Invalid paymentMethod', 400);
      update.paymentMethod = paymentMethod;
    }
    if (date !== undefined) {
      const parsed = parseDate(date);
      if (!parsed) return fail(res, 'Invalid date', 400);
      update.date = parsed;
    }
    if (note !== undefined) update.note = note;

    const saved = await ExpenseLog.findByIdAndUpdate(req.params.id, { $set: update }, { new: true });
    return ok(res, saved, 'Expense updated');
  } catch (error) {
    next(error);
  }
};

/** Removes an entry and undoes it on the bill or vendor it was paid from; an error message if it cannot. */
const undoExpenseLog = async (log: IExpenseLog): Promise<string | null> => {
  if (log.source?.kind === 'recurring') {
    const bill = await RecurringBill.findById(log.source.id);
    if (bill) {
      const r = reverseRecurringPayment(recurringState(bill), {
        amount: log.amount,
        cycle: log.source.cycle,
        completedInstallment: log.source.completedInstallment,
        part: log.source.part,
      });
      if ('error' in r) return r.error;
      await RecurringBill.findByIdAndUpdate(bill._id, { $set: r.state });
    }
  } else if (log.source?.kind === 'vendor') {
    if (log.source.txnId) await VendorTxn.findByIdAndDelete(log.source.txnId);
    await VendorAccount.findByIdAndUpdate(log.source.id, { $inc: { balance: log.amount } });
  }
  await ExpenseLog.findByIdAndDelete(log._id);
  return null;
};

/** Deletes an entry and undoes it on the bill or vendor it was paid from (a cleared cheque goes back to pending). */
export const deleteExpenseLog = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const log = await ExpenseLog.findById(req.params.id);
    if (!log) return fail(res, 'Expense not found', 404);

    const error = await undoExpenseLog(log);
    if (error) return fail(res, error, 400);
    await releaseCheque(log._id);
    return ok(res, { _id: log._id }, 'Expense deleted');
  } catch (error) {
    next(error);
  }
};

// ─── Recurring bills ─────────────────────────────────────────────────────────

export const listRecurringBills = async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const bills = await RecurringBill.find({}).sort({ name: 1 });
    return ok(res, bills);
  } catch (error) {
    next(error);
  }
};

export const createRecurringBill = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { name, kind, category, totalInstallments, paidInstallments, dueDay, dueDate, note } = req.body ?? {};
    if (!name || typeof name !== 'string' || !name.trim()) return fail(res, 'name is required', 400);
    if (!RECURRING_KINDS.includes(kind)) return fail(res, 'kind must be installment, ongoing or one_time', 400);
    const scope = req.body?.scope ?? 'business';
    if (!BILL_SCOPES.includes(scope)) return fail(res, 'scope must be business or personal', 400);
    const parsedDueDate = dueDate ? parseDate(dueDate) : undefined;
    if (dueDate && !parsedDueDate) return fail(res, 'Invalid dueDate', 400);
    const parts = parseParts(req.body?.parts);
    if (typeof parts === 'string') return fail(res, parts, 400);
    // A split bill's amount is the sum of its parts.
    const amount = parts ? parts.reduce((t, p) => t + p.amount, 0) : req.body?.amount;
    if (!isAmount(amount)) return fail(res, 'amount must be greater than 0', 400);
    const cat = category ?? 'utility';
    if (!isCategory(cat)) return fail(res, 'Invalid category', 400);
    if (kind === 'installment' && !(Number.isInteger(totalInstallments) && totalInstallments > 0))
      return fail(res, 'totalInstallments is required for installment bills', 400);
    const alreadyPaid = Number.isInteger(paidInstallments) && paidInstallments > 0 ? paidInstallments : 0;
    if (kind === 'installment' && alreadyPaid >= totalInstallments)
      return fail(res, 'Already-paid installments must be fewer than the total', 400);
    if (dueDay !== undefined && dueDay !== null && !(Number.isInteger(dueDay) && dueDay >= 1 && dueDay <= 31))
      return fail(res, 'dueDay must be 1–31', 400);

    const bill = await RecurringBill.create({
      name: name.trim(),
      kind,
      category: cat,
      amount: money(amount),
      totalInstallments: kind === 'installment' ? totalInstallments : undefined,
      paidInstallments: alreadyPaid,
      dueRemaining: money(amount),
      cycle: 1,
      dueDay: kind === 'one_time' ? undefined : dueDay ?? undefined,
      dueDate: kind === 'one_time' ? parsedDueDate ?? undefined : undefined,
      scope: scope as BillScope,
      status: 'active',
      parts: parts ?? undefined,
      note,
    });
    return ok(res, bill, 'Recurring expense added', 201);
  } catch (error) {
    next(error);
  }
};

/** Edits name / category / due day / note / total installments. Amount changes go through reset. */
export const updateRecurringBill = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const bill = await RecurringBill.findById(req.params.id);
    if (!bill) return fail(res, 'Recurring expense not found', 404);
    const { name, category, dueDay, note, totalInstallments, scope, dueDate } = req.body ?? {};
    const update: Partial<IRecurringBill> = {};
    if (scope !== undefined) {
      if (!BILL_SCOPES.includes(scope)) return fail(res, 'scope must be business or personal', 400);
      update.scope = scope;
    }
    if (dueDate !== undefined && bill.kind === 'one_time') {
      const parsed = dueDate ? parseDate(dueDate) : null;
      if (dueDate && !parsed) return fail(res, 'Invalid dueDate', 400);
      update.dueDate = parsed ?? undefined;
    }
    if (name !== undefined) {
      if (typeof name !== 'string' || !name.trim()) return fail(res, 'name is required', 400);
      update.name = name.trim();
    }
    if (category !== undefined) {
      if (!isCategory(category)) return fail(res, 'Invalid category', 400);
      update.category = category;
    }
    if (dueDay !== undefined) {
      if (dueDay !== null && !(Number.isInteger(dueDay) && dueDay >= 1 && dueDay <= 31))
        return fail(res, 'dueDay must be 1–31', 400);
      update.dueDay = dueDay ?? undefined;
    }
    if (note !== undefined) update.note = note;
    if (totalInstallments !== undefined && bill.kind === 'installment') {
      if (!(Number.isInteger(totalInstallments) && totalInstallments >= bill.paidInstallments && totalInstallments > 0))
        return fail(res, 'totalInstallments cannot be below installments already paid', 400);
      update.totalInstallments = totalInstallments;
      update.status = bill.paidInstallments >= totalInstallments ? 'completed' : 'active';
    }
    const saved = await RecurringBill.findByIdAndUpdate(bill._id, { $set: update }, { new: true });
    return ok(res, saved, 'Recurring expense updated');
  } catch (error) {
    next(error);
  }
};

export const deleteRecurringBill = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const bill = await RecurringBill.findByIdAndDelete(req.params.id);
    if (!bill) return fail(res, 'Recurring expense not found', 404);
    // Past payments stay in the expense log as plain entries.
    return ok(res, { _id: bill._id }, 'Recurring expense deleted');
  } catch (error) {
    next(error);
  }
};

export const payRecurringBill = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const bill = await RecurringBill.findById(req.params.id);
    if (!bill) return fail(res, 'Recurring expense not found', 404);
    const { amount, date, paymentMethod, note } = req.body ?? {};
    const part = req.body?.part === undefined || req.body?.part === null ? undefined : Number(req.body.part);
    const partInfo = part !== undefined ? bill.parts?.[part] : undefined;
    // A part is paid by its own method unless the request says otherwise.
    const method = paymentMethod ?? partInfo?.method ?? 'cash';
    if (!isMethod(method)) return fail(res, 'Invalid paymentMethod', 400);
    const parsed = parseDate(date);
    if (!parsed) return fail(res, 'Invalid date', 400);

    const state = recurringState(bill);
    const r = applyRecurringPayment(state, Number(amount), part);
    if ('error' in r) return fail(res, r.error, 400);

    const log = await ExpenseLog.create({
      date: parsed,
      category: bill.category,
      amount: money(Number(amount)),
      note: note || (partInfo ? `${bill.name} · ${partInfo.label}` : bill.name),
      paymentMethod: method,
      scope: bill.scope ?? 'business',
      source: {
        kind: 'recurring',
        id: bill._id,
        name: bill.name,
        cycle: state.cycle,
        completedInstallment: !!r.completedInstallment,
        part,
      },
    });
    const saved = await RecurringBill.findByIdAndUpdate(bill._id, { $set: r.state }, { new: true });
    return ok(res, { bill: saved, log }, 'Payment logged', 201);
  } catch (error) {
    next(error);
  }
};

export const resetRecurringBill = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const bill = await RecurringBill.findById(req.params.id);
    if (!bill) return fail(res, 'Recurring expense not found', 404);
    const { amount, partAmounts } = req.body ?? {};
    const r = resetRecurring(
      recurringState(bill),
      amount === undefined || amount === null ? undefined : Number(amount),
      Array.isArray(partAmounts) ? partAmounts.map(Number) : undefined,
    );
    if ('error' in r) return fail(res, r.error, 400);
    const saved = await RecurringBill.findByIdAndUpdate(bill._id, { $set: r.state }, { new: true });
    return ok(res, saved, 'Amount reset');
  } catch (error) {
    next(error);
  }
};

export const recurringBillPayments = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const logs = await ExpenseLog.find({ 'source.id': req.params.id }).sort({ date: -1 });
    return ok(res, logs);
  } catch (error) {
    next(error);
  }
};

// ─── Vendors ─────────────────────────────────────────────────────────────────

export const listVendors = async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const vendors = await VendorAccount.find({}).sort({ name: 1 });
    return ok(res, vendors);
  } catch (error) {
    next(error);
  }
};

export const createVendor = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { name, phone, note, openingBalance } = req.body ?? {};
    if (!name || typeof name !== 'string' || !name.trim()) return fail(res, 'name is required', 400);
    const category = req.body?.category ?? 'other';
    if (!VENDOR_CATEGORIES.includes(category)) return fail(res, 'category must be fragrance, lens, frame or other', 400);
    const existing = await VendorAccount.findOne({ name: name.trim() });
    if (existing) return fail(res, 'A vendor with this name already exists', 400);

    const vendor = await VendorAccount.create({ name: name.trim(), phone, note, category, balance: 0 });
    if (isAmount(openingBalance)) {
      await VendorTxn.create({
        vendorId: vendor._id,
        vendorName: vendor.name,
        date: new Date(),
        type: 'add',
        amount: money(openingBalance),
        note: 'Opening balance',
      });
      vendor.balance = money(openingBalance);
      await VendorAccount.findByIdAndUpdate(vendor._id, { $set: { balance: vendor.balance } });
    }
    return ok(res, vendor, 'Vendor added', 201);
  } catch (error) {
    next(error);
  }
};

export const updateVendor = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { name, phone, note } = req.body ?? {};
    const update: Record<string, unknown> = {};
    if (name !== undefined) {
      if (typeof name !== 'string' || !name.trim()) return fail(res, 'name is required', 400);
      update.name = name.trim();
    }
    if (phone !== undefined) update.phone = phone;
    if (req.body?.category !== undefined) {
      if (!VENDOR_CATEGORIES.includes(req.body.category)) return fail(res, 'category must be fragrance, lens, frame or other', 400);
      update.category = req.body.category;
    }
    if (note !== undefined) update.note = note;
    const saved = await VendorAccount.findByIdAndUpdate(req.params.id, { $set: update }, { new: true });
    if (!saved) return fail(res, 'Vendor not found', 404);
    return ok(res, saved, 'Vendor updated');
  } catch (error) {
    next(error);
  }
};

export const deleteVendor = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const vendor = await VendorAccount.findById(req.params.id);
    if (!vendor) return fail(res, 'Vendor not found', 404);
    if (Math.abs(vendor.balance) > 0.001)
      return fail(res, 'Vendor still has a balance. Settle it to ₹0 before deleting.', 400);
    await VendorAccount.findByIdAndDelete(vendor._id);
    return ok(res, { _id: vendor._id }, 'Vendor deleted');
  } catch (error) {
    next(error);
  }
};

/** Transactions oldest-first with a running balance, so the ledger always adds up. */
export const vendorTxns = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const txns = await VendorTxn.find({ vendorId: req.params.id });
    let running = 0;
    const rows = txns
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
        || new Date(a.createdAt ?? 0).getTime() - new Date(b.createdAt ?? 0).getTime())
      .map((t) => {
        running = money(running + vendorBalanceDelta(t.type, t.amount));
        return { ...t, balanceAfter: running };
      });
    return ok(res, rows.reverse());
  } catch (error) {
    next(error);
  }
};

export const addVendorTxn = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const vendor = await VendorAccount.findById(req.params.id);
    if (!vendor) return fail(res, 'Vendor not found', 404);
    const { type, amount, date, note, paymentMethod } = req.body ?? {};
    if (!VENDOR_TXN_TYPES.includes(type)) return fail(res, 'type must be add, pay or less', 400);
    if (!isAmount(amount)) return fail(res, 'amount must be greater than 0', 400);
    const parsed = parseDate(date);
    if (!parsed) return fail(res, 'Invalid date', 400);
    const method = paymentMethod ?? 'cash';
    if (!isMethod(method)) return fail(res, 'Invalid paymentMethod', 400);

    const txnType = type as VendorTxnType;
    const amt = money(amount);
    const record = async (t: VendorTxnType) => {
      const txn = await VendorTxn.create({
        vendorId: vendor._id,
        vendorName: vendor.name,
        date: parsed,
        type: t,
        amount: amt,
        note,
        paymentMethod: method,
      });
      if (t === 'pay') {
        const log = await ExpenseLog.create({
          date: parsed,
          category: 'vendor',
          amount: amt,
          note: note || `Paid ${vendor.name}`,
          paymentMethod: method,
          source: { kind: 'vendor', id: vendor._id, name: vendor.name, txnId: txn._id },
        });
        await VendorTxn.findByIdAndUpdate(txn._id, { $set: { expenseLogId: log._id } });
      }
      return txn;
    };

    const txn = await record(txnType);
    // Cash purchase: the bill and its payment in one go (counts toward the cap, owes nothing).
    const paidNow = txnType === 'add' && req.body?.paidNow === true;
    if (paidNow) await record('pay');

    const saved = paidNow
      ? await VendorAccount.findById(vendor._id)
      : await VendorAccount.findByIdAndUpdate(vendor._id, { $inc: { balance: vendorBalanceDelta(txnType, amt) } }, { new: true });
    return ok(res, { vendor: saved, txn }, paidNow ? 'Cash purchase logged' : 'Vendor entry logged', 201);
  } catch (error) {
    next(error);
  }
};

/**
 * Edits a vendor entry, including its type (e.g. a payment saved as a discount by mistake).
 * The vendor balance and the matching expense-log entry follow the change.
 */
export const updateVendorTxn = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const txn = await VendorTxn.findById(req.params.txnId);
    if (!txn) return fail(res, 'Entry not found', 404);
    const { type, amount, date, note, paymentMethod } = req.body ?? {};

    const nextType: VendorTxnType = type ?? txn.type;
    if (!VENDOR_TXN_TYPES.includes(nextType)) return fail(res, 'type must be add, pay or less', 400);
    const nextAmount = amount !== undefined ? amount : txn.amount;
    if (!isAmount(nextAmount)) return fail(res, 'amount must be greater than 0', 400);
    const nextDate = date !== undefined ? parseDate(date) : new Date(txn.date);
    if (!nextDate) return fail(res, 'Invalid date', 400);
    const nextMethod = paymentMethod ?? txn.paymentMethod ?? 'cash';
    if (!isMethod(nextMethod)) return fail(res, 'Invalid paymentMethod', 400);
    const nextNote = note !== undefined ? note || undefined : txn.note;
    const amt = money(nextAmount);

    // Expense-log entry: kept in step with the entry while it is a payment.
    let expenseLogId: string | undefined = txn.expenseLogId;
    const logFields = {
      date: nextDate,
      amount: amt,
      note: nextNote || `Paid ${txn.vendorName}`,
      paymentMethod: nextMethod,
    };
    if (nextType === 'pay' && expenseLogId) {
      await ExpenseLog.findByIdAndUpdate(expenseLogId, { $set: logFields });
    } else if (nextType === 'pay') {
      const log = await ExpenseLog.create({
        ...logFields,
        category: 'vendor',
        source: { kind: 'vendor', id: txn.vendorId, name: txn.vendorName, txnId: txn._id },
      });
      expenseLogId = log._id;
    } else if (expenseLogId) {
      await ExpenseLog.findByIdAndDelete(expenseLogId);
      await releaseCheque(expenseLogId);
      expenseLogId = undefined;
    }

    const saved = await VendorTxn.findByIdAndUpdate(
      txn._id,
      {
        $set: { type: nextType, amount: amt, date: nextDate, note: nextNote, paymentMethod: nextMethod, expenseLogId },
        ...(expenseLogId ? {} : { $unset: { expenseLogId: '' } }),
      },
      { new: true },
    );
    const delta = money(vendorBalanceDelta(nextType, amt) - vendorBalanceDelta(txn.type, txn.amount));
    const vendor = delta
      ? await VendorAccount.findByIdAndUpdate(txn.vendorId, { $inc: { balance: delta } }, { new: true })
      : await VendorAccount.findById(txn.vendorId);
    return ok(res, { vendor, txn: saved }, 'Entry updated');
  } catch (error) {
    next(error);
  }
};

export const deleteVendorTxn = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const txn = await VendorTxn.findById(req.params.txnId);
    if (!txn) return fail(res, 'Entry not found', 404);
    if (txn.expenseLogId) {
      await ExpenseLog.findByIdAndDelete(txn.expenseLogId);
      await releaseCheque(txn.expenseLogId);
    }
    await VendorTxn.findByIdAndDelete(txn._id);
    await VendorAccount.findByIdAndUpdate(txn.vendorId, { $inc: { balance: -vendorBalanceDelta(txn.type, txn.amount) } });
    return ok(res, { _id: txn._id }, 'Entry deleted');
  } catch (error) {
    next(error);
  }
};

// ─── Vendor planning ─────────────────────────────────────────────────────────

const loadSettings = async () => {
  const doc = await LedgerSetting.findOne({});
  return {
    vendorSharePct: doc?.vendorSharePct ?? DEFAULT_LEDGER_SETTING.vendorSharePct,
    repaymentBudget: doc?.repaymentBudget ?? DEFAULT_LEDGER_SETTING.repaymentBudget,
    planStartedAt: doc?.planStartedAt ? new Date(doc.planStartedAt) : undefined,
    purchaseCaps: { ...DEFAULT_LEDGER_SETTING.purchaseCaps, ...(doc?.purchaseCaps ?? {}) },
    _id: doc?._id,
  };
};

export const getLedgerSettings = async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const { _id, ...settings } = await loadSettings();
    return ok(res, settings);
  } catch (error) {
    next(error);
  }
};

export const updateLedgerSettings = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const current = await loadSettings();
    const { vendorSharePct, purchaseCaps, repaymentBudget } = req.body ?? {};
    const next_ = {
      vendorSharePct: current.vendorSharePct,
      repaymentBudget: current.repaymentBudget,
      purchaseCaps: { ...current.purchaseCaps },
      planStartedAt: current.planStartedAt,
    };
    if (repaymentBudget !== undefined) {
      if (!(typeof repaymentBudget === 'number' && repaymentBudget >= 0)) return fail(res, 'repaymentBudget must be 0 or more', 400);
      next_.repaymentBudget = money(repaymentBudget);
      // Entries already in the books (old dues typed in as bills) are not this plan's progress.
      if (!next_.planStartedAt && next_.repaymentBudget > 0) next_.planStartedAt = new Date();
    }
    if (vendorSharePct !== undefined) {
      if (!(typeof vendorSharePct === 'number' && vendorSharePct >= 0 && vendorSharePct <= 100))
        return fail(res, 'vendorSharePct must be 0–100', 400);
      next_.vendorSharePct = vendorSharePct;
    }
    if (purchaseCaps !== undefined) {
      for (const [k, v] of Object.entries(purchaseCaps as Record<string, unknown>)) {
        if (!VENDOR_CATEGORIES.includes(k as never)) return fail(res, `Unknown category ${k}`, 400);
        if (!(typeof v === 'number' && v >= 0)) return fail(res, 'Caps must be 0 or more', 400);
        next_.purchaseCaps[k as keyof typeof next_.purchaseCaps] = money(v);
      }
    }
    if (current._id) await LedgerSetting.findByIdAndUpdate(current._id, { $set: next_ });
    else await LedgerSetting.create(next_);
    return ok(res, next_, 'Settings saved');
  } catch (error) {
    next(error);
  }
};

const monthRange = (ym?: string) => {
  const now = new Date();
  const [y, m] = ym && /^\d{4}-\d{2}$/.test(ym) ? ym.split('-').map(Number) : [now.getFullYear(), now.getMonth() + 1];
  return { from: new Date(y, m - 1, 1), to: new Date(y, m, 0, 23, 59, 59, 999), month: `${y}-${String(m).padStart(2, '0')}` };
};

/** Per category: owed, bought and paid in the month, and the purchase cap. */
export const vendorSummary = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { from, to, month } = monthRange(req.query.month as string | undefined);
    const [vendors, txns, settings] = await Promise.all([
      VendorAccount.find({}),
      VendorTxn.find({ date: { $gte: from, $lte: to } }),
      loadSettings(),
    ]);
    const categories = vendorCategorySummary(vendors, txns, settings.purchaseCaps, VENDOR_CATEGORIES);
    const started = settings.planStartedAt;
    const tracked = started ? txns.filter((t) => new Date(t.createdAt ?? t.date) >= started) : txns;
    const repayment = repaymentProgress(tracked, settings.repaymentBudget, settings.purchaseCaps);
    return ok(res, { month, categories, repayment, vendorSharePct: settings.vendorSharePct });
  } catch (error) {
    next(error);
  }
};

/** Schedule rows as month → vendorId → amount, the shape the screen uses. */
const scheduleMap = (rows?: { month: string; vendorId: string; amount: number }[]) => {
  const out: Record<string, Record<string, number>> = {};
  for (const r of rows ?? []) (out[r.month] ??= {})[r.vendorId] = r.amount;
  return out;
};

/**
 * The repayment schedule, what was actually paid to each vendor in those months, and pending
 * cheques to vendors by the month they are dated (planned payments on top of the schedule).
 */
export const getSchedule = async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const doc = await LedgerSetting.findOne({});
    const schedule = scheduleMap(doc?.schedule);
    const thisMonth = monthKeyOf(new Date());
    const months = [...new Set([thisMonth, ...Object.keys(schedule)])].sort();
    const [y, m] = months[0].split('-').map(Number);
    const [txns, pending] = await Promise.all([
      VendorTxn.find({ date: { $gte: new Date(y, m - 1, 1) } }),
      Cheque.find({ status: 'pending' }),
    ]);
    return ok(res, { schedule, paid: paidByMonth(txns), cheques: chequesByMonth(pending), thisMonth });
  } catch (error) {
    next(error);
  }
};

/**
 * Makes the month-by-month repayment schedule from next month on: the fixed monthly repayment split
 * across vendors by what they owe, after pending cheques. Replaces the schedule from next month on;
 * earlier months are kept.
 */
export const generateSchedule = async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const settings = await loadSettings();
    if (!(settings.repaymentBudget > 0)) return fail(res, 'Save a monthly repayment amount first', 400);
    const startMonth = addMonthKey(monthKeyOf(new Date()), 1);
    const [vendors, pending, doc] = await Promise.all([
      VendorAccount.find({}),
      Cheque.find({ status: 'pending' }),
      LedgerSetting.findOne({}),
    ]);
    const generated = buildRepaymentSchedule(vendors, settings.repaymentBudget, startMonth, chequesByMonth(pending));
    const rows = [...(doc?.schedule ?? []).filter((r) => r.month < startMonth), ...generated];

    if (doc) await LedgerSetting.findByIdAndUpdate(doc._id, { $set: { schedule: rows } });
    else await LedgerSetting.create({ ...DEFAULT_LEDGER_SETTING, schedule: rows });
    return ok(res, { schedule: scheduleMap(rows) }, 'Schedule made');
  } catch (error) {
    next(error);
  }
};

/** Clears the schedule from this month on; earlier months stay for the record. Cheques are untouched. */
export const clearSchedule = async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const doc = await LedgerSetting.findOne({});
    const thisMonth = monthKeyOf(new Date());
    const rows = (doc?.schedule ?? []).filter((r) => r.month < thisMonth);
    if (doc) await LedgerSetting.findByIdAndUpdate(doc._id, { $set: { schedule: rows } });
    return ok(res, { schedule: scheduleMap(rows) }, 'Schedule cleared');
  } catch (error) {
    next(error);
  }
};

/** Sets one cell of the schedule: { month: 'YYYY-MM', vendorId, amount } (0 clears it). */
export const setScheduleAmount = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { month, vendorId, amount } = req.body ?? {};
    if (!isMonthKey(month)) return fail(res, 'month must be YYYY-MM', 400);
    if (typeof vendorId !== 'string' || !vendorId) return fail(res, 'vendorId is required', 400);
    if (!(typeof amount === 'number' && amount >= 0)) return fail(res, 'amount must be 0 or more', 400);
    if (!isPaymentStep(amount))
      return fail(res, `Plan payments in ₹${PAYMENT_STEP.toLocaleString('en-IN')} steps, or one payment under ₹${PAYMENT_STEP.toLocaleString('en-IN')}`, 400);
    if (!(await VendorAccount.findById(vendorId))) return fail(res, 'Vendor not found', 404);

    const doc = await LedgerSetting.findOne({});
    const rows = (doc?.schedule ?? []).filter((r) => !(r.month === month && r.vendorId === vendorId));
    if (amount > 0) rows.push({ month, vendorId, amount: money(amount) });

    if (doc) await LedgerSetting.findByIdAndUpdate(doc._id, { $set: { schedule: rows } });
    else await LedgerSetting.create({ ...DEFAULT_LEDGER_SETTING, schedule: rows });
    return ok(res, { schedule: scheduleMap(rows) }, 'Schedule updated');
  } catch (error) {
    next(error);
  }
};

// ─── Daily savings (what the owner kept aside each day) ──────────────────────

/** Entries between ?from= and ?to= (YYYY-MM-DD, inclusive), newest first. */
export const listDailySavings = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { from, to } = req.query as { from?: string; to?: string };
    if ((from && !isDayKey(from)) || (to && !isDayKey(to))) return fail(res, 'from / to must be YYYY-MM-DD', 400);
    const filter: Record<string, unknown> = {};
    if (from || to) filter.day = { ...(from ? { $gte: from } : {}), ...(to ? { $lte: to } : {}) };
    const rows = await DailySaving.find(filter);
    return ok(res, rows.sort((a, b) => b.day.localeCompare(a.day)));
  } catch (error) {
    next(error);
  }
};

/**
 * Sets what was kept on a day: { day, fixed, vendor, fixedOnline?, vendorOnline?, note? }.
 * fixedOnline / vendorOnline are the online (UPI / bank) part of each total; the rest is cash.
 * Re-saving a day replaces it.
 */
export const saveDailySaving = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { day, fixed, vendor, fixedOnline = 0, vendorOnline = 0, note } = req.body ?? {};
    if (!isDayKey(day)) return fail(res, 'day must be YYYY-MM-DD', 400);
    const ok0 = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v >= 0;
    if (!ok0(fixed) || !ok0(vendor)) return fail(res, 'fixed and vendor must be 0 or more', 400);
    if (!ok0(fixedOnline) || !ok0(vendorOnline)) return fail(res, 'fixedOnline and vendorOnline must be 0 or more', 400);
    if (fixedOnline > fixed || vendorOnline > vendor) return fail(res, 'online part cannot be more than the total', 400);

    const entry = {
      day,
      fixed: money(fixed),
      vendor: money(vendor),
      fixedOnline: money(fixedOnline),
      vendorOnline: money(vendorOnline),
      note: note || undefined,
    };
    const existing = await DailySaving.findOne({ day });
    const saved = existing
      ? await DailySaving.findByIdAndUpdate(existing._id, { $set: entry }, { new: true })
      : await DailySaving.create(entry);
    return ok(res, saved, 'Saved');
  } catch (error) {
    next(error);
  }
};

// ─── Planned payments (cheques, dated UPI / bank / cash payments) ────────────

const PLANNED_FIELDS = ['method', 'chequeNo', 'bank', 'amount', 'chequeDate', 'vendorId', 'billId', 'billPart', 'payee', 'category', 'note'] as const;

/**
 * Validated planned-payment fields from the request. `current` is the entry being edited (fields not
 * sent keep its values). Cleared links come back as '' / null so the caller can $unset them.
 */
const parsePlanned = async (body: Record<string, unknown>, current?: ICheque): Promise<Record<string, unknown> | string> => {
  const out: Record<string, unknown> = {};
  const has = (k: string) => body[k] !== undefined;
  const editing = !!current;

  const method = has('method') ? body.method : current?.method ?? 'cheque';
  if (!PLANNED_METHODS.includes(method as PlannedMethod)) return 'method must be cheque, upi, bank_transfer or cash';
  if (!editing || has('method')) out.method = method;

  if (method === 'cheque') {
    const chequeNo = has('chequeNo') ? body.chequeNo : current?.chequeNo;
    if (typeof chequeNo !== 'string' || !chequeNo.trim()) return 'Cheque number is required';
    if (!editing || has('chequeNo')) out.chequeNo = chequeNo.trim();
  } else if (has('chequeNo') || (editing && current?.chequeNo)) {
    out.chequeNo = '';
  }
  if (!editing || has('amount')) {
    if (!isAmount(body.amount)) return 'amount must be greater than 0';
    out.amount = money(body.amount);
  }
  if (!editing || has('chequeDate')) {
    const d = typeof body.chequeDate === 'string' && body.chequeDate ? parseDate(body.chequeDate) : null;
    if (!d) return 'Payment date is required';
    out.chequeDate = d;
  }
  if (has('bank')) out.bank = typeof body.bank === 'string' ? body.bank.trim() : '';
  if (has('note')) out.note = typeof body.note === 'string' ? body.note.trim() : '';

  // Pay to: a vendor (pays down their dues), a recurring / one-off bill (pays its cycle), or anyone else.
  if (!editing || has('vendorId') || has('billId') || has('payee')) {
    if (typeof body.vendorId === 'string' && body.vendorId) {
      const vendor = await VendorAccount.findById(body.vendorId);
      if (!vendor) return 'Vendor not found';
      Object.assign(out, { vendorId: vendor._id, billId: '', billPart: null, payee: vendor.name, category: 'vendor' });
    } else if (typeof body.billId === 'string' && body.billId) {
      const bill = await RecurringBill.findById(body.billId);
      if (!bill || bill.status === 'completed') return 'Bill not found or already paid';
      const part = body.billPart === undefined || body.billPart === null || body.billPart === '' ? undefined : Number(body.billPart);
      if (bill.parts?.length && (part === undefined || !bill.parts[part])) return 'Choose which part of the bill this pays';
      const p = bill.parts?.length && part !== undefined ? bill.parts[part] : undefined;
      Object.assign(out, {
        billId: bill._id,
        billPart: p ? part : null,
        vendorId: '',
        payee: p ? `${bill.name} · ${p.label}` : bill.name,
        category: bill.category,
      });
    } else {
      if (typeof body.payee !== 'string' || !body.payee.trim()) return 'Choose a vendor or bill, or type who this is for';
      const category = body.category ?? 'running';
      if (!isCategory(category)) return 'Invalid category';
      Object.assign(out, { vendorId: '', billId: '', billPart: null, payee: body.payee.trim(), category });
    }
  } else if (has('category') && !current?.vendorId && !current?.billId) {
    if (!isCategory(body.category)) return 'Invalid category';
    out.category = body.category;
  }
  return out;
};

/** Splits parsed fields into $set and $unset ('' / null mean "remove"). */
const toUpdate = (fields: Record<string, unknown>) => {
  const $set: Record<string, unknown> = {};
  const $unset: Record<string, ''> = {};
  for (const [k, v] of Object.entries(fields)) {
    if (v === '' || v === null) $unset[k] = '';
    else $set[k] = v;
  }
  return { $set, $unset };
};

/** Planned payments, earliest date first; ?status= narrows to one status. */
export const listCheques = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const status = req.query.status as string | undefined;
    const cheques = await Cheque.find(status ? { status } : {});
    return ok(res, cheques.sort((a, b) => new Date(a.chequeDate).getTime() - new Date(b.chequeDate).getTime()));
  } catch (error) {
    next(error);
  }
};

export const createCheque = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const fields = await parsePlanned(req.body ?? {});
    if (typeof fields === 'string') return fail(res, fields, 400);
    const cheque = await Cheque.create({ ...toUpdate(fields).$set, status: 'pending' } as unknown as ICheque);
    return ok(res, cheque, 'Payment planned', 201);
  } catch (error) {
    next(error);
  }
};

/** Edits a planned payment that has not been paid. */
export const updateCheque = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const cheque = await Cheque.findById(req.params.id);
    if (!cheque) return fail(res, 'Planned payment not found', 404);
    if (cheque.status === 'cleared') return fail(res, 'This payment is done. Undo it first, then edit.', 400);
    const body = Object.fromEntries(PLANNED_FIELDS.filter((k) => req.body?.[k] !== undefined).map((k) => [k, req.body[k]]));
    const fields = await parsePlanned(body, cheque);
    if (typeof fields === 'string') return fail(res, fields, 400);
    const { $set, $unset } = toUpdate(fields);
    const saved = await Cheque.findByIdAndUpdate(cheque._id, Object.keys($unset).length ? { $set, $unset } : { $set }, { new: true });
    return ok(res, saved, 'Planned payment updated');
  } catch (error) {
    next(error);
  }
};

/**
 * The planned payment went out (cheque encashed, UPI sent…): it becomes an expense-log entry. A vendor
 * payment also goes on the vendor's ledger; a bill payment is paid against the bill's current cycle.
 */
export const clearCheque = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const cheque = await Cheque.findById(req.params.id);
    if (!cheque) return fail(res, 'Planned payment not found', 404);
    if (cheque.status !== 'pending') return fail(res, `This payment is ${cheque.status}`, 400);
    const date = parseDate(req.body?.date);
    if (!date) return fail(res, 'Invalid date', 400);
    const method: PlannedMethod = cheque.method ?? 'cheque';
    const how = method === 'cheque' ? `Cheque #${cheque.chequeNo}${cheque.bank ? ` · ${cheque.bank}` : ''}` : `Planned ${METHOD_LABEL[method]}`;
    const note = `${how}${cheque.note ? ` · ${cheque.note}` : ''}`;

    let logId: string;
    if (cheque.vendorId) {
      const vendor = await VendorAccount.findById(cheque.vendorId);
      if (!vendor) return fail(res, 'The vendor on this payment no longer exists. Edit it first.', 400);
      const txn = await VendorTxn.create({
        vendorId: vendor._id,
        vendorName: vendor.name,
        date,
        type: 'pay',
        amount: cheque.amount,
        note,
        paymentMethod: method,
      });
      const log = await ExpenseLog.create({
        date,
        category: 'vendor',
        amount: cheque.amount,
        note,
        paymentMethod: method,
        chequeId: cheque._id,
        source: { kind: 'vendor', id: vendor._id, name: vendor.name, txnId: txn._id },
      });
      await VendorTxn.findByIdAndUpdate(txn._id, { $set: { expenseLogId: log._id } });
      await VendorAccount.findByIdAndUpdate(vendor._id, { $inc: { balance: -cheque.amount } });
      logId = log._id;
    } else if (cheque.billId) {
      const bill = await RecurringBill.findById(cheque.billId);
      if (!bill) return fail(res, 'The bill on this payment no longer exists. Edit it first.', 400);
      const state = recurringState(bill);
      const r = applyRecurringPayment(state, cheque.amount, cheque.billPart ?? undefined);
      if ('error' in r) return fail(res, r.error, 400);
      const log = await ExpenseLog.create({
        date,
        category: bill.category,
        amount: cheque.amount,
        note: `${cheque.payee} · ${note}`,
        paymentMethod: method,
        scope: bill.scope ?? 'business',
        chequeId: cheque._id,
        source: {
          kind: 'recurring',
          id: bill._id,
          name: bill.name,
          cycle: state.cycle,
          completedInstallment: !!r.completedInstallment,
          part: cheque.billPart ?? undefined,
        },
      });
      await RecurringBill.findByIdAndUpdate(bill._id, { $set: r.state });
      logId = log._id;
    } else {
      const log = await ExpenseLog.create({
        date,
        category: cheque.category,
        amount: cheque.amount,
        note: `${cheque.payee} · ${note}`,
        paymentMethod: method,
        chequeId: cheque._id,
      });
      logId = log._id;
    }
    const saved = await Cheque.findByIdAndUpdate(
      cheque._id,
      { $set: { status: 'cleared', clearedOn: date, expenseLogId: logId } },
      { new: true },
    );
    return ok(res, saved, method === 'cheque' ? 'Cheque cleared' : 'Payment done');
  } catch (error) {
    next(error);
  }
};

/**
 * Bounced (cheques) / cancelled / back to pending. Moving a paid entry to bounced or pending undoes
 * its payment (expense entry, vendor payment or bill payment).
 */
export const setChequeStatus = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const cheque = await Cheque.findById(req.params.id);
    if (!cheque) return fail(res, 'Planned payment not found', 404);
    const status = req.body?.status as ChequeStatus;
    if (!['pending', 'bounced', 'cancelled'].includes(status)) return fail(res, 'status must be pending, bounced or cancelled', 400);
    if (status === 'bounced' && (cheque.method ?? 'cheque') !== 'cheque') return fail(res, 'Only cheques can bounce', 400);
    if (status === cheque.status) return ok(res, cheque, 'No change');

    if (cheque.status === 'cleared') {
      if (status === 'cancelled') return fail(res, 'A paid entry cannot be cancelled. Undo it first.', 400);
      const log = cheque.expenseLogId ? await ExpenseLog.findById(cheque.expenseLogId) : null;
      if (log) {
        const error = await undoExpenseLog(log);
        if (error) return fail(res, error, 400);
      }
    }
    const saved = await Cheque.findByIdAndUpdate(
      cheque._id,
      { $set: { status }, $unset: { expenseLogId: '', clearedOn: '' } },
      { new: true },
    );
    return ok(res, saved, status === 'pending' ? 'Planned again' : `Marked ${status}`);
  } catch (error) {
    next(error);
  }
};

export const deleteCheque = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const cheque = await Cheque.findById(req.params.id);
    if (!cheque) return fail(res, 'Planned payment not found', 404);
    if (cheque.status === 'cleared') return fail(res, 'This payment is done. Undo it first.', 400);
    await Cheque.findByIdAndDelete(cheque._id);
    return ok(res, { _id: cheque._id }, 'Planned payment deleted');
  } catch (error) {
    next(error);
  }
};
