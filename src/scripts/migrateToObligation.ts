/**
 * One-time migration: VendorBill + Debt → Obligation, DebtPayment → ObligationPayment
 *
 * Run:
 *   npx ts-node -r tsconfig-paths/register src/scripts/migrateToObligation.ts
 *
 * Safe to run multiple times — skips docs that already have migratedFrom set.
 */

import mongoose from 'mongoose';
import { env } from '../config/env';
import { VendorBill } from '../models/VendorBill.model';
import { Debt } from '../models/Debt.model';
import { DebtPayment } from '../models/DebtPayment.model';
import { Obligation } from '../models/Obligation.model';
import { ObligationPayment } from '../models/ObligationPayment.model';

async function run() {
  await mongoose.connect(env.MONGODB_URI);
  console.log('Connected');

  let created = 0;
  let paymentsMigrated = 0;

  // ── VendorBill → Obligation (category='vendor') ───────────────────────────
  const bills = await VendorBill.find({});
  for (const bill of bills) {
    const exists = await Obligation.findOne({ migratedFrom: 'VendorBill', creditor: bill.vendorName, originalAmount: bill.totalAmount, billDate: bill.billDate });
    if (exists) continue;

    const obl = await Obligation.create({
      creditor:       bill.vendorName,
      category:       'vendor',
      subcategory:    bill.category,
      originalAmount: bill.totalAmount,
      alreadyPaid:    bill.paidAmount,
      priority:       bill.status === 'overdue' ? '1-critical' : '3-normal',
      dueDate:        bill.dueDate,
      billDate:       bill.billDate,
      minPayment:     0,
      notes:          bill.note,
      status:         bill.status === 'paid' ? 'paid' : 'open',
      items:          bill.items.map((i) => ({ description: i.description, amount: i.amount })),
      migratedFrom:   'VendorBill',
      createdAt:      bill.createdAt,
    });
    created++;

    // Migrate embedded payments
    for (const p of bill.payments) {
      await ObligationPayment.create({
        obligationId: obl._id,
        creditor:     bill.vendorName,
        amountPaid:   p.amount,
        date:         p.date,
        method:       p.method,
        notes:        p.note,
      });
      paymentsMigrated++;
    }
  }
  console.log(`VendorBill: migrated ${created} obligations, ${paymentsMigrated} payments`);

  // ── Debt → Obligation ─────────────────────────────────────────────────────
  const debts = await Debt.find({});
  let debtCreated = 0;
  const debtIdToObligationId = new Map<string, mongoose.Types.ObjectId>();

  for (const debt of debts) {
    const exists = await Obligation.findOne({ migratedFrom: 'Debt', creditor: debt.creditor });
    if (exists) {
      debtIdToObligationId.set(debt.debtId, exists._id as mongoose.Types.ObjectId);
      continue;
    }

    const category = debt.paymentType === 'deadline-full' ? 'loan' : 'personal';
    const obl = await Obligation.create({
      creditor:       debt.creditor,
      category,
      originalAmount: debt.originalAmount,
      alreadyPaid:    debt.alreadyPaid,
      priority:       debt.priority,
      dueDate:        debt.dueDate,
      minPayment:     debt.minimumPayment,
      notes:          debt.notes,
      status:         debt.status === 'paid' ? 'paid' : 'open',
      migratedFrom:   'Debt',
      createdAt:      debt.createdAt,
    });
    debtIdToObligationId.set(debt.debtId, obl._id as mongoose.Types.ObjectId);
    debtCreated++;
  }
  console.log(`Debt: migrated ${debtCreated} obligations`);

  // ── DebtPayment → ObligationPayment ──────────────────────────────────────
  const debtPayments = await DebtPayment.find({}).sort({ date: 1 });
  let dpMigrated = 0;

  for (const dp of debtPayments) {
    const obligationId = debtIdToObligationId.get(dp.debtId);
    if (!obligationId) continue;

    const alreadyMigrated = await ObligationPayment.findOne({ obligationId, amountPaid: dp.amountPaid, date: dp.date });
    if (alreadyMigrated) continue;

    await ObligationPayment.create({
      obligationId,
      creditor:   dp.creditor,
      amountPaid: dp.amountPaid,
      date:       dp.date,
      notes:      dp.notes,
    });
    dpMigrated++;
  }
  console.log(`DebtPayment: migrated ${dpMigrated} obligation payments`);

  await mongoose.disconnect();
  console.log('Done. Total obligations created:', created + debtCreated);
}

run().catch((err) => { console.error(err); process.exit(1); });
