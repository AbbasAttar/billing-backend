/**
 * Script: syncObligationsToExpenses.ts
 *
 * Syncs all current ObligationPayment logs and initial paid balances into Cashflow (expenses).
 * Safe to run multiple times (idempotent).
 *
 * Run:
 *   npx ts-node -r tsconfig-paths/register src/scripts/syncObligationsToExpenses.ts
 */

import mongoose from 'mongoose';
import { env } from '../config/env';
import { Obligation } from '../models/Obligation.model';
import { ObligationPayment } from '../models/ObligationPayment.model';
import { Cashflow, normalizePaymentMethod } from '../models/Cashflow.model';

async function run() {
  await mongoose.connect(env.MONGODB_URI);
  console.log('Connected to MongoDB');

  let paymentsSynced = 0;
  let missingPaymentsCreated = 0;

  // 1. Check all ObligationPayment records
  const payments = await ObligationPayment.find().sort({ date: 1 });
  console.log(`Found ${payments.length} obligation payment logs.`);

  for (const p of payments) {
    const exists = await Cashflow.findOne({ obligationPaymentId: p._id });
    if (exists) {
      console.log(`Payment ${p._id} (${p.creditor}: ₹${p.amountPaid}) already has Cashflow expense ${exists._id}`);
      continue;
    }

    const obl = await Obligation.findById(p.obligationId).lean();
    const creditor = p.creditor || obl?.creditor || 'Obligation';
    const category = obl?.subcategory?.trim() || (obl?.category === 'vendor' ? 'stock' : obl?.category) || 'miscellaneous';
    const paymentMethod = normalizePaymentMethod(p.method);
    const note = p.notes
      ? `${p.notes} (${creditor})`
      : `Payment for ${obl?.category || 'obligation'}: ${creditor}`;

    const created = await Cashflow.create({
      type: 'expense',
      date: p.date || new Date(),
      amount: p.amountPaid,
      paidAmount: p.amountPaid,
      status: 'logged',
      category,
      vendorName: creditor,
      note,
      paymentMethod,
      items: [],
      payments: [
        {
          amount: p.amountPaid,
          date: p.date || new Date(),
          method: paymentMethod,
          note: p.notes,
        },
      ],
      obligationId: p.obligationId,
      obligationPaymentId: p._id,
      createdAt: (p as any).createdAt || p.date || new Date(),
    });

    console.log(`✓ Created Cashflow expense ${created._id} for ${creditor}: ₹${p.amountPaid} (${category})`);
    paymentsSynced++;
  }

  // 2. Check Obligations where alreadyPaid > 0 but total ObligationPayment < alreadyPaid
  const obligations = await Obligation.find({ alreadyPaid: { $gt: 0 } });
  for (const obl of obligations) {
    const existingPayments = await ObligationPayment.find({ obligationId: obl._id });
    const totalRecorded = existingPayments.reduce((sum, item) => sum + item.amountPaid, 0);
    const unrecordedAmount = obl.alreadyPaid - totalRecorded;

    if (unrecordedAmount > 0.01) {
      const paymentDate = obl.billDate || (obl as any).createdAt || new Date();
      const paymentNote = obl.notes?.trim() ? `Initial payment: ${obl.notes.trim()}` : `Initial payment`;

      const payment = await ObligationPayment.create({
        obligationId: obl._id,
        creditor: obl.creditor,
        amountPaid: unrecordedAmount,
        date: paymentDate,
        method: 'cash',
        notes: paymentNote,
      });

      const category = obl.subcategory?.trim() || (obl.category === 'vendor' ? 'stock' : obl.category) || 'miscellaneous';
      await Cashflow.create({
        type: 'expense',
        date: paymentDate,
        amount: unrecordedAmount,
        paidAmount: unrecordedAmount,
        status: 'logged',
        category,
        vendorName: obl.creditor,
        note: `${paymentNote} (${obl.creditor})`,
        paymentMethod: 'cash',
        items: [],
        payments: [
          {
            amount: unrecordedAmount,
            date: paymentDate,
            method: 'cash',
            note: paymentNote,
          },
        ],
        obligationId: obl._id,
        obligationPaymentId: payment._id,
      });

      missingPaymentsCreated++;
      paymentsSynced++;
    }
  }

  console.log(`\nSync Summary:`);
  console.log(`  - Synced ${paymentsSynced} payments/logs to Cashflow expenses.`);
  if (missingPaymentsCreated > 0) {
    console.log(`  - Created ${missingPaymentsCreated} initial payment records for previously unlogged advance balances.`);
  }

  await mongoose.disconnect();
  console.log('Done.');
}

run().catch((err) => {
  console.error('Sync failed:', err);
  process.exit(1);
});
