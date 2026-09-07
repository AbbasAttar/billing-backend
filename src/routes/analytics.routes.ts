import { Router } from 'express';
import {
    getAnalyticsSummary,
    getMonthlySummary,
    getTopItems,
    getCategorySales,
    getFragranceTypeMix,
    getLensTypeDemand,
    getExecutiveAnalytics,
    getUnitEconomicsAnalytics,
} from '../controllers/analytics.controller';

const router = Router();

router.get('/executive',          getExecutiveAnalytics);
router.get('/unit-economics',     getUnitEconomicsAnalytics);
router.get('/summary',            getAnalyticsSummary);
router.get('/monthly-summary',    getMonthlySummary);
router.get('/top-items',          getTopItems);
router.get('/category-sales',     getCategorySales);
router.get('/fragrance-type-mix', getFragranceTypeMix);
router.get('/lens-type-demand',   getLensTypeDemand);

export default router;
