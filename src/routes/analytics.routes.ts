import { Router } from 'express';
import { getAnalyticsSummary, getMonthlySummary, getTopItems, getCategorySales, getFragranceTypeMix, getLensTypeDemand } from '../controllers/analytics.controller';

const router = Router();

router.get('/summary',          getAnalyticsSummary);
router.get('/monthly-summary',  getMonthlySummary);
router.get('/top-items',        getTopItems);
router.get('/category-sales',     getCategorySales);
router.get('/fragrance-type-mix', getFragranceTypeMix);
router.get('/lens-type-demand',   getLensTypeDemand);

export default router;
