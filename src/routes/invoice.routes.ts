import { Router } from 'express';
import {
  getAllInvoices,
  getInvoiceById,
  getInvoicesByCustomer,
  createInvoice,
  updateInvoice,
  addPayment,
  deleteInvoice,
  addItemToInvoice,
  removeItemFromInvoice,
  updateItemInInvoice,
} from '../controllers/invoice.controller';

const router = Router();

router.get('/customer/:customerId', getInvoicesByCustomer);
router.get('/', getAllInvoices);
router.get('/:id', getInvoiceById);
router.post('/', createInvoice);
router.put('/:id', updateInvoice);
router.patch('/:id/payment', addPayment);
router.post('/:id/items', addItemToInvoice);
router.delete('/:id/items/:itemIndex', removeItemFromInvoice);
router.put('/:id/items/:itemId', updateItemInInvoice);
router.delete('/:id', deleteInvoice);

export default router;
