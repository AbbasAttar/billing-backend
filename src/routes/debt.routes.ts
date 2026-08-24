import { Router } from 'express';
import { listDebts, createDebt, updateDebt, deleteDebt, getDashboard } from '../controllers/debt.controller';

const router = Router();

router.get('/dashboard', getDashboard);
router.get('/', listDebts);
router.post('/', createDebt);
router.put('/:id', updateDebt);
router.delete('/:id', deleteDebt);

export default router;
