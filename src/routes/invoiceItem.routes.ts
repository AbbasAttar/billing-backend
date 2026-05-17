import { Router } from 'express';
import {
  getAllInvoiceItems,
  getInvoiceItemById,
  createInvoiceItem,
  updateInvoiceItem,
  deleteInvoiceItem,
} from '../controllers/invoiceItem.controller';

const router = Router();

router.get('/', getAllInvoiceItems);
router.get('/:id', getInvoiceItemById);
router.post('/', createInvoiceItem);
router.put('/:id', updateInvoiceItem);
router.delete('/:id', deleteInvoiceItem);

export default router;
