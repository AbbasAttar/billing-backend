import { Router } from 'express';
import {
  listGoals, createGoal, updateGoal, deleteGoal,
  listTransactions, addTransaction, deleteTransaction,
} from '../controllers/savingGoal.controller';

const router = Router();

router.get('/', listGoals);
router.post('/', createGoal);
router.put('/:id', updateGoal);
router.delete('/:id', deleteGoal);

router.get('/:id/transactions', listTransactions);
router.post('/:id/transactions', addTransaction);
router.delete('/:id/transactions/:txnId', deleteTransaction);

export default router;
