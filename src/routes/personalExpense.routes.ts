import { Router } from 'express';
import {
  createPersonalExpense,
  deletePersonalExpense,
  getPersonalExpenseById,
  getPersonalExpenses,
  getPersonalExpenseSummary,
  updatePersonalExpense,
} from '../controllers/personalExpense.controller';

const router = Router();

router.post('/', createPersonalExpense);
router.get('/', getPersonalExpenses);
router.get('/summary', getPersonalExpenseSummary);
router.get('/:id', getPersonalExpenseById);
router.put('/:id', updatePersonalExpense);
router.delete('/:id', deletePersonalExpense);

export default router;
