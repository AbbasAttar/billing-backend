import { Router } from 'express';
import {
  listRecurring, createRecurring, updateRecurring, deleteRecurring,
  generateDueEntries, getDueSoon, addDeposit, deleteDeposit,
} from '../controllers/recurringExpense.controller';

const router = Router();

// Specific routes before parameterized routes
router.get('/due-soon', getDueSoon);
router.post('/generate', generateDueEntries);

router.get('/', listRecurring);
router.post('/', createRecurring);
router.put('/:id', updateRecurring);
router.delete('/:id', deleteRecurring);

// Deposit sub-resource
router.post('/:id/deposits', addDeposit);
router.delete('/:id/deposits/:depositId', deleteDeposit);

export default router;
