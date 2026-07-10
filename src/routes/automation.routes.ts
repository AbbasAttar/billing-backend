import { Router } from 'express';
import {
  listRules,
  createRule,
  getRule,
  updateRule,
  deleteRule,
  runRule,
  runAll,
  getLogs,
} from '../controllers/automation.controller';

const router = Router();

router.get('/rules', listRules);
router.post('/rules', createRule);
router.get('/rules/:id', getRule);
router.patch('/rules/:id', updateRule);
router.delete('/rules/:id', deleteRule);
router.post('/rules/:id/run', runRule);
router.post('/run-all', runAll);
router.get('/logs', getLogs);

export default router;
