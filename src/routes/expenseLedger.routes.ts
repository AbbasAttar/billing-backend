import { Router } from 'express';
import {
  listExpenseLogs,
  createExpenseLog,
  updateExpenseLog,
  deleteExpenseLog,
  listRecurringBills,
  createRecurringBill,
  updateRecurringBill,
  deleteRecurringBill,
  payRecurringBill,
  resetRecurringBill,
  recurringBillPayments,
  listVendors,
  createVendor,
  updateVendor,
  deleteVendor,
  vendorTxns,
  addVendorTxn,
  updateVendorTxn,
  deleteVendorTxn,
  getLedgerSettings,
  updateLedgerSettings,
  vendorSummary,
  getSchedule,
  setScheduleAmount,
  generateSchedule,
  clearSchedule,
  listCheques,
  createCheque,
  updateCheque,
  clearCheque,
  setChequeStatus,
  deleteCheque,
  listDailySavings,
  saveDailySaving,
} from '../controllers/expenseLedger.controller';

const router = Router();

router.get('/logs', listExpenseLogs);
router.post('/logs', createExpenseLog);
router.put('/logs/:id', updateExpenseLog);
router.delete('/logs/:id', deleteExpenseLog);

router.get('/recurring', listRecurringBills);
router.post('/recurring', createRecurringBill);
router.put('/recurring/:id', updateRecurringBill);
router.delete('/recurring/:id', deleteRecurringBill);
router.post('/recurring/:id/pay', payRecurringBill);
router.post('/recurring/:id/reset', resetRecurringBill);
router.get('/recurring/:id/payments', recurringBillPayments);

router.get('/vendors', listVendors);
router.post('/vendors', createVendor);
router.put('/vendors/:id', updateVendor);
router.delete('/vendors/:id', deleteVendor);
router.get('/vendors/:id/txns', vendorTxns);
router.post('/vendors/:id/txns', addVendorTxn);
router.put('/vendor-txns/:txnId', updateVendorTxn);
router.delete('/vendor-txns/:txnId', deleteVendorTxn);

router.get('/settings', getLedgerSettings);
router.put('/settings', updateLedgerSettings);
router.get('/vendor-summary', vendorSummary);
router.get('/schedule', getSchedule);
router.put('/schedule', setScheduleAmount);
router.post('/schedule/generate', generateSchedule);
router.delete('/schedule', clearSchedule);

router.get('/cheques', listCheques);
router.post('/cheques', createCheque);
router.put('/cheques/:id', updateCheque);
router.post('/cheques/:id/clear', clearCheque);
router.post('/cheques/:id/status', setChequeStatus);
router.delete('/cheques/:id', deleteCheque);
router.get('/daily-savings', listDailySavings);
router.put('/daily-savings', saveDailySaving);

export default router;
