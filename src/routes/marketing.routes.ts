import { Router } from 'express';
import {
  getMarketingSummary,
  getSuggestions,
  getSegment,
  invalidateCache,
  generateCopy,
  getOpportunities,
} from '../controllers/marketing.controller';

const router = Router();

router.get('/summary', getMarketingSummary);
router.get('/suggestions', getSuggestions);
router.get('/segments/:segment', getSegment);
router.get('/opportunities', getOpportunities);
router.post('/cache/invalidate', invalidateCache);
router.post('/generate-copy', generateCopy);

export default router;
