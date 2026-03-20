import { Router } from 'express';
import { getAnalyticsSummary, getMonthlySummary, getTopItems } from '../controllers/analytics.controller';

const router = Router();

router.get('/summary',          getAnalyticsSummary);
router.get('/monthly-summary',  getMonthlySummary);
router.get('/top-items',        getTopItems);

export default router;
