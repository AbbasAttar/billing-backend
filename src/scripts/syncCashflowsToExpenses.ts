/**
 * Script: syncCashflowsToExpenses.ts
 *
 * Safely migrates all historical expenses and payables from the `cashflows` collection
 * into the `expenses` (Expense) and `vendorbills` (VendorBill) collections.
 *
 * Safe and Idempotent:
 * - Never resets or deletes any database collection.
 * - Checks for existing matching records before creating anything.
 *
 * Run:
 *   npx ts-node src/scripts/syncCashflowsToExpenses.ts
 */

import mongoose from 'express';
import mongooseLib from 'mongoose';
import { env } from '../config/env';
import { Expense, EXPENSE_CATEGORIES, ExpenseCategory, EXPENSE_PAYMENT_METHODS, ExpensePaymentMethod } from '../models/Expense.model';
import { VendorBill, BILL_STATUSES, BillStatus } from '../models/VendorBill.model';
import { Cashflow } from '../models/Cashflow.model';

function normalizeExpenseCategory(cat?: string): ExpenseCategory {
  if (!cat) return 'miscellaneous';
  const c = cat.trim().toLowerCase();
  if (c === 'tea' || c === 'staff_tea' || c === 'chai') return 'staff_tea';
  if (c === 'maintenance' || c === 'repair') return 'maintenance';
  if (c === 'delivery' || c === 'courier' || c === 'shipping') return 'delivery';
  if (c === 'rent') return 'rent';
  if (c === 'salary' || c === 'payroll') return 'salary';
  if (c === 'utilities' || c === 'electricity' || c === 'light_bill') return 'utilities';
  if (c === 'stock' || c === 'vendor' || c === 'inventory' || c === 'lens' || c === 'frame') return 'stock';
  if (c === 'transport' || c === 'fuel' || c === 'petrol') return 'transport';
  if (c === 'marketing' || c === 'ad' || c === 'advertising' || c === 'banner') return 'marketing';
  if (EXPENSE_CATEGORIES.includes(c as ExpenseCategory)) return c as ExpenseCategory;
  return 'miscellaneous';
}

function normalizeExpensePaymentMethod(method?: string): ExpensePaymentMethod {
  if (!method) return 'cash';
  const m = method.trim().toLowerCase().replace(/\s+/g, '_');
  if (m === 'bank_transfer' || m === 'bank' || m === 'neft' || m === 'rtgs' || m === 'imps' || m === 'transfer' || m === 'online') {
    return 'bank_transfer';
  }
  if (m === 'upi' || m === 'gpay' || m === 'phonepe' || m === 'paytm') return 'upi';
  if (m === 'card' || m === 'credit_card' || m === 'debit_card') return 'card';
  if (m === 'cash') return 'cash';
  return 'cash';
}

async function run() {
  await mongooseLib.connect(env.MONGODB_URI);
  console.log('Connected to MongoDB');

  // ── 1. Migrate Cashflows (type: 'expense') -> Expense ──────────────────────
  const cashflowExpenses = await Cashflow.find({ type: 'expense' }).lean();
  console.log(`Found ${cashflowExpenses.length} expense entries in Cashflow.`);

  let expensesMigrated = 0;
  let expensesSkipped = 0;

  for (const item of cashflowExpenses) {
    const itemDate = new Date(item.date);
    const itemAmount = item.amount;
    const vendorName = (item.vendorName || '').trim();
    const note = (item.note || '').trim();

    // Check if an expense with the same date (+- 24 hours), amount, and note/vendor already exists in Expense collection
    const startWindow = new Date(itemDate.getTime() - 24 * 60 * 60 * 1000);
    const endWindow = new Date(itemDate.getTime() + 24 * 60 * 60 * 1000);

    const existing = await Expense.findOne({
      amount: itemAmount,
      date: { $gte: startWindow, $lte: endWindow },
      $or: [
        { vendorName: vendorName || undefined },
        { note: note || undefined },
        { category: normalizeExpenseCategory(item.category) },
      ],
    });

    if (existing) {
      expensesSkipped++;
      continue;
    }

    const category = normalizeExpenseCategory(item.category);
    const paymentMethod = normalizeExpensePaymentMethod(item.paymentMethod);

    await Expense.create({
      date: itemDate,
      amount: itemAmount,
      category,
      note: note || undefined,
      vendorName: vendorName || undefined,
      paymentMethod,
      isVoid: item.status === 'void',
      voidReason: item.voidReason || (item.status === 'void' ? 'Voided in Cashflow' : undefined),
      createdAt: (item as any).createdAt || itemDate,
      updatedAt: (item as any).updatedAt || itemDate,
    });

    console.log(`  ✓ Synced expense: ${itemDate.toISOString().slice(0, 10)} | ₹${itemAmount} | ${category} | ${vendorName || note || '(no desc)'}`);
    expensesMigrated++;
  }

  console.log(`\nExpense Sync Summary: ${expensesMigrated} migrated, ${expensesSkipped} already existed.`);

  // ── 2. Migrate Cashflows (type: 'payable') -> VendorBill ───────────────────
  const cashflowPayables = await Cashflow.find({ type: 'payable' }).lean();
  console.log(`\nFound ${cashflowPayables.length} payable entries in Cashflow.`);

  let billsMigrated = 0;
  let billsSkipped = 0;

  for (const p of cashflowPayables) {
    const vendorName = (p.vendorName || 'Unknown Vendor').trim();
    const totalAmount = p.amount;

    const existingBill = await VendorBill.findOne({
      vendorName,
      totalAmount,
    });

    if (existingBill) {
      billsSkipped++;
      continue;
    }

    const billDate = new Date(p.date || new Date());
    const dueDate = p.dueDate ? new Date(p.dueDate) : billDate;
    const paidAmount = p.paidAmount || 0;

    let status: BillStatus = 'pending';
    if (paidAmount >= totalAmount) status = 'paid';
    else if (paidAmount > 0) status = 'partially_paid';
    else if (dueDate < new Date()) status = 'overdue';

    await VendorBill.create({
      vendorName,
      billDate,
      dueDate,
      totalAmount,
      paidAmount,
      status,
      category: p.category || 'stock',
      note: p.note,
      items: p.items || [],
      payments: p.payments || [],
      createdAt: (p as any).createdAt || billDate,
      updatedAt: (p as any).updatedAt || billDate,
    });

    console.log(`  ✓ Synced VendorBill: ${vendorName} | Total: ₹${totalAmount} | Paid: ₹${paidAmount} | Status: ${status}`);
    billsMigrated++;
  }

  console.log(`\nVendorBill Sync Summary: ${billsMigrated} migrated, ${billsSkipped} already existed.`);

  await mongooseLib.disconnect();
  console.log('\nSync complete.');
}

run().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
