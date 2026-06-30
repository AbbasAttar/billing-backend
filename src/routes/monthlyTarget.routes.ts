import { Router } from 'express';
import {
  upsertMonthlyTarget,
  getMonthlyTargets,
  getCurrentMonthTarget,
  getMonthlyTargetByMonth,
  deleteMonthlyTarget,
} from '../controllers/monthlyTarget.controller';

const router = Router();

router.get('/', getMonthlyTargets);
router.get('/current', getCurrentMonthTarget);
router.get('/:month', getMonthlyTargetByMonth);
router.put('/:month', upsertMonthlyTarget);
router.delete('/:id', deleteMonthlyTarget);

export default router;
