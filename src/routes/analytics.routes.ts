import { Router } from 'express';
import { getAnalyticsSummary } from '../controllers/analytics.controller';

const router = Router();

router.get('/summary', getAnalyticsSummary);

export default router;
