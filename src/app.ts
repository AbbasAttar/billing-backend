import express from 'express';
import cors from 'cors';
import { env } from './config/env';
import { errorHandler } from './middleware/errorHandler';

import customerRoutes from './routes/customer.routes';
import opticalNumberRoutes from './routes/opticalNumber.routes';
import opticalLensRoutes from './routes/opticalLens.routes';
import prescriptionRoutes from './routes/prescription.routes';
import fragranceRoutes from './routes/fragrance.routes';
import frameRoutes from './routes/frame.routes';
import invoiceItemRoutes from './routes/invoiceItem.routes';
import invoiceRoutes from './routes/invoice.routes';
import analyticsRoutes from './routes/analytics.routes';
import dashboardRoutes from './routes/dashboard.routes';
import cashflowRoutes from './routes/cashflow.routes';
import paymentsRoutes from './routes/payments.routes';
import salesRoutes from './routes/sales.routes';
import inventoryIntelligenceRoutes from './routes/inventory.routes';
import personalExpenseRoutes from './routes/personalExpense.routes';
import monthlyTargetRoutes from './routes/monthlyTarget.routes';
import coatingRoutes from './routes/coating.routes';
import lensPricingRoutes from './routes/lensPricing.routes';
import lensStockRoutes from './routes/lensStock.routes';
import frameCompanyRoutes from './routes/frameCompany.routes';
import frameStockRoutes from './routes/frameStock.routes';
import frameColorRoutes from './routes/frameColor.routes';
import marketingRoutes from './routes/marketing.routes';
import campaignRoutes from './routes/campaign.routes';
import automationRoutes from './routes/automation.routes';
import lostSaleRoutes from './routes/lostSale.routes';
import savingGoalRoutes from './routes/savingGoal.routes';
import recurringExpenseRoutes from './routes/recurringExpense.routes';
import contactLensRoutes from './routes/contactLens.routes';
import publicRoutes from './routes/public.routes';
import authRoutes from './routes/auth.routes';
import siteSettingRoutes from './routes/siteSetting.routes';
import blogRoutes from './routes/blog.routes';
import razorpayRoutes from './routes/razorpay.routes';
import notificationRoutes from './routes/notification.routes';
import debtRoutes from './routes/debt.routes';
import commitmentRoutes from './routes/commitment.routes';
import debtConfigRoutes from './routes/debtConfig.routes';
import debtPaymentRoutes from './routes/debtPayment.routes';
import obligationRoutes from './routes/obligation.routes';
import expenseRoutes from './routes/expense.routes';
import vendorBillRoutes from './routes/vendorBill.routes';
import obligationPaymentRoutes from './routes/obligationPayment.routes';
import financeOverviewRoutes from './routes/financeOverview.routes';
import lensReorderRoutes from './routes/lensReorder.routes';
import purchaseEntryRoutes from './routes/purchaseEntry.routes';
import wholesalerQueueRoutes from './routes/wholesalerQueue.routes';
import { handleWebhook } from './controllers/razorpay.controller';

const app = express();

// Middleware
const corsOrigin = env.CORS_ORIGIN.split(',');
app.use(cors({ origin: corsOrigin, credentials: true }));

// Razorpay webhook must receive raw body for signature verification
app.post('/api/razorpay/webhook', express.raw({ type: 'application/json' }), handleWebhook);

app.use(express.json());

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// API Routes
app.use('/api/customers', customerRoutes);
app.use('/api/optical-numbers', opticalNumberRoutes); // legacy — kept for backward compat
app.use('/api/optical-lenses', opticalLensRoutes);
app.use('/api/prescriptions', prescriptionRoutes);
app.use('/api/fragrances', fragranceRoutes);
app.use('/api/frames', frameRoutes);
app.use('/api/invoice-items', invoiceItemRoutes);
app.use('/api/invoices', invoiceRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/cashflow', cashflowRoutes);
app.use('/api/expenses', expenseRoutes);
app.use('/api/vendor-bills', vendorBillRoutes);
app.use('/api/payments', paymentsRoutes);
app.use('/api/sales', salesRoutes);
app.use('/api/inventory', inventoryIntelligenceRoutes);
app.use('/api/personal-expenses', personalExpenseRoutes);
app.use('/api/monthly-targets', monthlyTargetRoutes);
app.use('/api/coatings', coatingRoutes);
app.use('/api/lens-pricing', lensPricingRoutes);
app.use('/api/lens-stock', lensStockRoutes);
app.use('/api/frame-companies', frameCompanyRoutes);
app.use('/api/frame-stock', frameStockRoutes);
app.use('/api/frame-colors', frameColorRoutes);
app.use('/api/marketing', marketingRoutes);
app.use('/api/campaigns', campaignRoutes);
app.use('/api/automation', automationRoutes);
app.use('/api/lost-sales', lostSaleRoutes);
app.use('/api/saving-goals', savingGoalRoutes);
app.use('/api/recurring-expenses', recurringExpenseRoutes);
app.use('/api/contact-lenses', contactLensRoutes);
app.use('/api/public', publicRoutes);
app.use('/api/auth',   authRoutes);
app.use('/api/settings', siteSettingRoutes);
app.use('/api/blog', blogRoutes);
app.use('/api/razorpay', razorpayRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/debts', debtRoutes);
app.use('/api/commitments', commitmentRoutes);
app.use('/api/debt-config', debtConfigRoutes);
app.use('/api/debt-payments', debtPaymentRoutes);
app.use('/api/obligations', obligationRoutes);
app.use('/api/obligation-payments', obligationPaymentRoutes);
app.use('/api/finance', financeOverviewRoutes);
app.use('/api/reports', lensReorderRoutes);
app.use('/api/purchases', purchaseEntryRoutes);
app.use('/api/wholesaler-queue', wholesalerQueueRoutes);

// 404 handler
app.use((_req, res) => {
  res.status(404).json({ message: 'Route not found' });
});

// Global error handler
app.use(errorHandler);

export default app;
