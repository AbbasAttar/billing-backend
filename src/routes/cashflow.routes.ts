import { Router } from 'express';
import {
  createCashflow,
  getCashflow,
  getCashflowById,
  getCashflowSummary,
  updateCashflow,
  deleteCashflow,
  voidCashflow,
  addPayment,
  getAISuggestion,
} from '../controllers/cashflow.controller';

const router = Router();

router.post('/', createCashflow);
router.get('/', getCashflow);
router.get('/summary', getCashflowSummary);
router.get('/suggestion', getAISuggestion);
router.get('/:id', getCashflowById);
router.put('/:id', updateCashflow);
router.delete('/:id', deleteCashflow);
router.patch('/:id/void', voidCashflow);
router.patch('/:id/payment', addPayment);

export default router;
