import { Router } from 'express';
import { getDailyKPIs, getRecentInvoices, getRecentPayments } from '../controllers/dashboard.controller';

const router = Router();

router.get('/daily',            getDailyKPIs);
router.get('/recent-invoices',  getRecentInvoices);
router.get('/recent-payments',  getRecentPayments);

export default router;
