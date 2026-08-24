import { Router } from 'express';
import { getLensReorderReport } from '../controllers/lensReorder.controller';

const router = Router();

// GET /api/reports/lens-reorder?days=90&leadTimeDays=5
router.get('/lens-reorder', getLensReorderReport);

export default router;
