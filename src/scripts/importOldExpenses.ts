/**
 * Copies store expenses from the old `expenses` collection into the new expense log
 * (`expenselogs`). Old documents are left untouched. Voided entries are skipped.
 *
 * Idempotent: each copy remembers its source in `importedFrom`, so re-running only adds new ones.
 * Defaults to a DRY RUN.
 *
 *   npx ts-node --transpile-only src/scripts/importOldExpenses.ts            # dry run
 *   npx ts-node --transpile-only src/scripts/importOldExpenses.ts --apply    # write
 */
import 'dotenv/config';
import { Expense, ExpenseCategory } from '../models/Expense.model';
import { ExpenseLog, ExpenseLogCategory, EXPENSE_LOG_METHODS, ExpenseLogMethod } from '../models/ExpenseLog.model';

const apply = process.argv.includes('--apply');

/** Old categories → the five new ones. Anything not listed is a shop running cost (utility). */
const CATEGORY_MAP: Partial<Record<ExpenseCategory, ExpenseLogCategory>> = {
  home_expense: 'home',
  staff_tea: 'staff_snacks',
  vendor_order: 'vendor',
  stock: 'vendor',
};

async function run() {
  console.log(`[import] mode=${apply ? 'APPLY' : 'DRY RUN'}`);
  const [old, existing] = await Promise.all([Expense.find({}), ExpenseLog.find({})]);
  const done = new Set(existing.map((l) => l.importedFrom).filter(Boolean));

  const todo = old.filter((e) => !e.isVoid && !done.has(e._id) && e.amount > 0);
  const byMonth: Record<string, { n: number; total: number }> = {};
  for (const e of todo) {
    const m = new Date(e.date).toISOString().slice(0, 7);
    byMonth[m] ??= { n: 0, total: 0 };
    byMonth[m].n++;
    byMonth[m].total += e.amount;
  }
  console.log(`[import] old=${old.length} alreadyImported=${done.size} toImport=${todo.length}`);
  console.table(byMonth);

  if (!apply) return;
  for (const e of todo) {
    const method: ExpenseLogMethod = EXPENSE_LOG_METHODS.includes(e.paymentMethod as ExpenseLogMethod)
      ? (e.paymentMethod as ExpenseLogMethod)
      : 'cash';
    await ExpenseLog.create({
      date: new Date(e.date),
      category: CATEGORY_MAP[e.category] ?? 'utility',
      amount: e.amount,
      note: [e.vendorName, e.note].filter(Boolean).join(' · ') || undefined,
      paymentMethod: method,
      importedFrom: e._id,
    });
  }
  console.log(`[import] wrote ${todo.length} entries`);
}

run()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
