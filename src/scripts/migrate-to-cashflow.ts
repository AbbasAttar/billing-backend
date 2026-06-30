/**
 * One-time migration: copies Expense + VendorBill documents into the unified Cashflow collection.
 * Run once with: npx ts-node src/scripts/migrate-to-cashflow.ts
 * The script skips migration if Cashflow already contains documents.
 */
import mongoose from 'mongoose';
import { Expense } from '../models/Expense.model';
import { VendorBill } from '../models/VendorBill.model';
import { Cashflow } from '../models/Cashflow.model';

async function migrate() {
  const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/billing';
  await mongoose.connect(uri);
  console.log('Connected to MongoDB');

  const existing = await Cashflow.countDocuments();
  if (existing > 0) {
    console.log(`Cashflow already has ${existing} documents — skipping migration.`);
    await mongoose.disconnect();
    return;
  }

  // ── Expenses ──────────────────────────────────────────────────────────────
  const expenses = await Expense.find().lean();
  console.log(`Migrating ${expenses.length} expenses...`);

  if (expenses.length > 0) {
    const expenseDocs = expenses.map((e: any) => ({
      type: 'expense',
      date: e.date,
      amount: e.amount,
      paidAmount: 0,
      status: e.isVoid ? 'void' : 'logged',
      category: e.category,
      vendorName: e.vendorName,
      note: e.note,
      paymentMethod: e.paymentMethod,
      voidReason: e.voidReason,
      items: [],
      payments: [],
      createdAt: e.createdAt,
      updatedAt: e.updatedAt,
    }));
    await Cashflow.insertMany(expenseDocs, { ordered: false });
    console.log(`  ✓ ${expenseDocs.length} expenses migrated`);
  }

  // ── Vendor Bills ──────────────────────────────────────────────────────────
  const bills = await VendorBill.find().lean();
  console.log(`Migrating ${bills.length} vendor bills...`);

  if (bills.length > 0) {
    const billDocs = bills.map((b: any) => ({
      type: 'payable',
      date: b.billDate,
      dueDate: b.dueDate,
      amount: b.totalAmount,
      paidAmount: b.paidAmount,
      status: b.status,
      category: b.category,
      vendorName: b.vendorName,
      note: b.note,
      items: b.items ?? [],
      payments: b.payments ?? [],
      createdAt: b.createdAt,
      updatedAt: b.updatedAt,
    }));
    await Cashflow.insertMany(billDocs, { ordered: false });
    console.log(`  ✓ ${billDocs.length} vendor bills migrated`);
  }

  console.log('Migration complete.');
  await mongoose.disconnect();
}

migrate().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
