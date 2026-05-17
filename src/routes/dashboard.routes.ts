import { Router } from 'express';
import {
  getActionQueue,
  getCashFlowInsights,
  getCommandCenter,
  getCustomerIntelligence,
  getDashboardInsights,
  getDashboardOverview,
  getDailyKPIs,
  getFinancialIntelligence,
  getProductIntelligence,
  getRecentInvoices,
  getRecentPayments,
  getSeasonalityIntelligence,
} from '../controllers/dashboard.controller';

const router = Router();

router.get('/daily',            getDailyKPIs);
router.get('/command-center',   getCommandCenter);
router.get('/overview',         getDashboardOverview);
router.get('/insights',         getDashboardInsights);
router.get('/customer-intelligence', getCustomerIntelligence);
router.get('/product-intelligence',  getProductIntelligence);
router.get('/seasonality',      getSeasonalityIntelligence);
router.get('/financial-intelligence', getFinancialIntelligence);
router.get('/action-queue',     getActionQueue);
router.get('/cashflow',         getCashFlowInsights);
router.get('/recent-invoices',  getRecentInvoices);
router.get('/recent-payments',  getRecentPayments);

export default router;
