import { Router } from 'express';
import {
  createExpense,
  getExpenseById,
  getExpenses,
  getExpenseSummary,
  voidExpense,
} from '../controllers/expense.controller';

const router = Router();

router.post('/', createExpense);
router.get('/', getExpenses);
router.get('/summary', getExpenseSummary);
router.get('/:id', getExpenseById);
router.patch('/:id/void', voidExpense);

export default router;
