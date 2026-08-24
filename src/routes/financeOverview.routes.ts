import { Router } from 'express';
import { getFinanceDashboard, getMonthlyPlan, saveMonthlyPlan, getAttentionNeeded } from '../controllers/financeOverview.controller';

const router = Router();

router.get('/dashboard', getFinanceDashboard);
router.get('/monthly-plan', getMonthlyPlan);
router.post('/monthly-plan', saveMonthlyPlan);
router.get('/attention', getAttentionNeeded);

export default router;
