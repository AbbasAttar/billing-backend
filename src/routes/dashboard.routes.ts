import { Router } from 'express';
import {
  getActionQueue,
  getCashFlowInsights,
  getCommandCenter,
  getCustomerIntelligence,
  getDashboardInsights,
  getDashboardOverview,
  getDailyKPIs,
  getDailyTasks,
  getFinancialIntelligence,
  getFinanceOverview,
  getOpportunityScore,
  getProfitLeakage,
  getProductIntelligence,
  getRecentInvoices,
  getRecentPayments,
  getSeasonalityIntelligence,
} from '../controllers/dashboard.controller';

const router = Router();

router.get('/daily',            getDailyKPIs);
router.get('/daily-tasks',      getDailyTasks);
router.get('/opportunity-score', getOpportunityScore);
router.get('/profit-leakage',   getProfitLeakage);
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
router.get('/finance-overview', getFinanceOverview);

export default router;
