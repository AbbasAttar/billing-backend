import { Router } from 'express';
import {
  getAllInvoices,
  getInvoiceById,
  getInvoicesByCustomer,
  createInvoice,
  updateInvoice,
  addPayment,
  updatePayment,
  deletePayment,
  deleteInvoice,
  addItemToInvoice,
  removeItemFromInvoice,
  updateItemInInvoice,
  renumberAllInvoices,
  pushToExcel,
  downloadTodayExcel,
  logDemand,
} from '../controllers/invoice.controller';
import {
  getMergedInvoices,
  getMergedInvoicesPage,
  searchInvoices,
} from '../controllers/invoiceList.controller';

const router = Router();

router.post('/renumber', renumberAllInvoices);
router.post('/demand', logDemand);
router.get('/today-excel', downloadTodayExcel);
router.get('/merged/page', getMergedInvoicesPage);
router.get('/merged', getMergedInvoices);
router.get('/search', searchInvoices);
router.get('/customer/:customerId', getInvoicesByCustomer);
router.get('/', getAllInvoices);
router.get('/:id', getInvoiceById);
router.post('/', createInvoice);
router.put('/:id', updateInvoice);
router.patch('/:id/payment', addPayment);
router.patch('/:id/payment/:paymentIndex', updatePayment);
router.delete('/:id/payment/:paymentIndex', deletePayment);
router.post('/:id/items', addItemToInvoice);
router.delete('/:id/items/:itemIndex', removeItemFromInvoice);
router.put('/:id/items/:itemId', updateItemInInvoice);
router.delete('/:id', deleteInvoice);
router.post('/:id/push-to-excel', pushToExcel);

export default router;
