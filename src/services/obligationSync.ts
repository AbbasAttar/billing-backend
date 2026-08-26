import { ObligationPayment } from '../models/ObligationPayment.model';
import { Obligation } from '../models/Obligation.model';
import { Cashflow, normalizePaymentMethod } from '../models/Cashflow.model';

export async function syncObligationPaymentsToCashflow(): Promise<{ synced: number }> {
  try {
    const payments = await ObligationPayment.find().lean();
    let syncedCount = 0;

    for (const payment of payments) {
      const exists = await Cashflow.findOne({ obligationPaymentId: payment._id });
      if (exists) continue;

      const obl = await Obligation.findById(payment.obligationId).lean();
      const creditor = payment.creditor || obl?.creditor || 'Obligation';
      const category = obl?.subcategory?.trim() || (obl?.category === 'vendor' ? 'stock' : obl?.category) || 'miscellaneous';
      const paymentMethod = normalizePaymentMethod(payment.method);
      const note = payment.notes
        ? `${payment.notes} (${creditor})`
        : `Payment for ${obl?.category || 'obligation'}: ${creditor}`;

      await Cashflow.create({
        type: 'expense',
        date: payment.date || new Date(),
        amount: payment.amountPaid,
        paidAmount: payment.amountPaid,
        status: 'logged',
        category,
        vendorName: creditor,
        note,
        paymentMethod,
        items: [],
        payments: [
          {
            amount: payment.amountPaid,
            date: payment.date || new Date(),
            method: paymentMethod,
            note: payment.notes,
          },
        ],
        obligationId: payment.obligationId,
        obligationPaymentId: payment._id,
        createdAt: (payment as any).createdAt || payment.date || new Date(),
      });

      syncedCount++;
    }

    // Also check for any obligations with alreadyPaid > sum of recorded ObligationPayment
    const obligations = await Obligation.find({ alreadyPaid: { $gt: 0 } }).lean();
    for (const obl of obligations) {
      const existingPayments = await ObligationPayment.find({ obligationId: obl._id }).lean();
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

        syncedCount++;
      }
    }

    if (syncedCount > 0) {
      console.log(`[ObligationSync] Synced ${syncedCount} obligation payments to Cashflow expenses.`);
    }

    return { synced: syncedCount };
  } catch (error) {
    console.error('[ObligationSync] Error syncing obligation payments to Cashflow:', error);
    return { synced: 0 };
  }
}
