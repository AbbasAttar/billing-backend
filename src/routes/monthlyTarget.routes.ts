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
router.get('/:month([0-9]{4}-[0-9]{2})', getMonthlyTargetByMonth);
router.put('/:month([0-9]{4}-[0-9]{2})', upsertMonthlyTarget);
router.delete('/:id', deleteMonthlyTarget);

export default router;
