import { Router } from 'express';
import {
  createExpense,
  deleteExpense,
  getExpenseById,
  getExpenses,
  getExpenseSummary,
  getExpenseHubSummary,
  updateExpense,
  voidExpense,
} from '../controllers/expense.controller';

const router = Router();

router.post('/', createExpense);
router.get('/', getExpenses);
router.get('/hub-summary', getExpenseHubSummary);
router.get('/summary', getExpenseSummary);
router.get('/:id', getExpenseById);
router.put('/:id', updateExpense);
router.delete('/:id', deleteExpense);
router.patch('/:id/void', voidExpense);

export default router;
