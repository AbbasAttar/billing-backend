import express from 'express';
import cors from 'cors';
import { env } from './config/env';
import { connectDB } from './config/database';
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
import customerRequirementRoutes from './routes/customerRequirement.routes';
import aiChatRoutes from './routes/aiChat.routes';
import { handleWebhook } from './controllers/razorpay.controller';

const app = express();

// Middleware
const allowedOrigins = env.CORS_ORIGIN.split(',').map((s) => s.trim()).filter(Boolean);
app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(origin)) return callback(null, true);
      if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return callback(null, true);
      if (/^https?:\/\/(.*attarwala.*|.*hosted\.app|.*web\.app|.*firebaseapp\.com)$/.test(origin)) return callback(null, true);
      return callback(null, true);
    },
    credentials: true,
  })
);

// Razorpay webhook must receive raw body for signature verification
app.post('/api/razorpay/webhook', express.raw({ type: 'application/json' }), handleWebhook);
app.post('/razorpay/webhook', express.raw({ type: 'application/json' }), handleWebhook);

app.use(express.json());

// Ensure active database connection before processing queries (excluding lightweight health checks)
app.use(async (req, res, next) => {
  if (req.path === '/health' || req.path === '/api/health') {
    return next();
  }
  try {
    await connectDB();
    next();
  } catch (err: any) {
    console.error('🔴 Database connection error in request middleware:', err.message);
    res.status(503).json({
      success: false,
      error: 'Database connection currently reconnecting. Please retry in a few seconds.',
      message: err.message,
    });
  }
});

// Create centralized API Router
const apiRouter = express.Router();

// Health check
apiRouter.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// API Routes mounted on apiRouter
apiRouter.use('/customers', customerRoutes);
apiRouter.use('/optical-numbers', opticalNumberRoutes); // legacy — kept for backward compat
apiRouter.use('/optical-lenses', opticalLensRoutes);
apiRouter.use('/prescriptions', prescriptionRoutes);
apiRouter.use('/fragrances', fragranceRoutes);
apiRouter.use('/frames', frameRoutes);
apiRouter.use('/invoice-items', invoiceItemRoutes);
apiRouter.use('/invoices', invoiceRoutes);
apiRouter.use('/analytics', analyticsRoutes);
apiRouter.use('/dashboard', dashboardRoutes);
apiRouter.use('/cashflow', cashflowRoutes);
apiRouter.use('/expenses', expenseRoutes);
apiRouter.use('/vendor-bills', vendorBillRoutes);
apiRouter.use('/payments', paymentsRoutes);
apiRouter.use('/sales', salesRoutes);
apiRouter.use('/inventory', inventoryIntelligenceRoutes);
apiRouter.use('/personal-expenses', personalExpenseRoutes);
apiRouter.use('/monthly-targets', monthlyTargetRoutes);
apiRouter.use('/coatings', coatingRoutes);
apiRouter.use('/lens-pricing', lensPricingRoutes);
apiRouter.use('/lens-stock', lensStockRoutes);
apiRouter.use('/frame-companies', frameCompanyRoutes);
apiRouter.use('/frame-stock', frameStockRoutes);
apiRouter.use('/frame-colors', frameColorRoutes);
apiRouter.use('/marketing', marketingRoutes);
apiRouter.use('/campaigns', campaignRoutes);
apiRouter.use('/automation', automationRoutes);
apiRouter.use('/lost-sales', lostSaleRoutes);
apiRouter.use('/saving-goals', savingGoalRoutes);
apiRouter.use('/recurring-expenses', recurringExpenseRoutes);
apiRouter.use('/contact-lenses', contactLensRoutes);
apiRouter.use('/public', publicRoutes);
apiRouter.use('/auth',   authRoutes);
apiRouter.use('/settings', siteSettingRoutes);
apiRouter.use('/blog', blogRoutes);
apiRouter.use('/razorpay', razorpayRoutes);
apiRouter.use('/notifications', notificationRoutes);
apiRouter.use('/debts', debtRoutes);
apiRouter.use('/commitments', commitmentRoutes);
apiRouter.use('/debt-config', debtConfigRoutes);
apiRouter.use('/debt-payments', debtPaymentRoutes);
apiRouter.use('/obligations', obligationRoutes);
apiRouter.use('/obligation-payments', obligationPaymentRoutes);
apiRouter.use('/finance', financeOverviewRoutes);
apiRouter.use('/reports', lensReorderRoutes);
apiRouter.use('/purchases', purchaseEntryRoutes);
apiRouter.use('/wholesaler-queue', wholesalerQueueRoutes);
apiRouter.use('/customer-requirements', customerRequirementRoutes);
apiRouter.use('/ai', aiChatRoutes);

// Root health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Support both /api/* and /* paths
app.use('/api', apiRouter);
app.use('/', apiRouter);

// 404 handler
app.use((_req, res) => {
  res.status(404).json({ message: 'Route not found' });
});

// Global error handler
app.use(errorHandler);

export default app;
