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
    getSalesDistributionAnalytics,
} from '../controllers/analytics.controller';
import { getFragranceInsights, getOpticsInsights } from '../controllers/categoryInsights.controller';

const router = Router();

router.get('/executive',          getExecutiveAnalytics);
router.get('/unit-economics',     getUnitEconomicsAnalytics);
router.get('/sales-distribution', getSalesDistributionAnalytics);
router.get('/summary',            getAnalyticsSummary);
router.get('/monthly-summary',    getMonthlySummary);
router.get('/top-items',          getTopItems);
router.get('/category-sales',     getCategorySales);
router.get('/fragrance-type-mix', getFragranceTypeMix);
router.get('/lens-type-demand',   getLensTypeDemand);
router.get('/insights/optics',    getOpticsInsights);
router.get('/insights/fragrance', getFragranceInsights);

export default router;
