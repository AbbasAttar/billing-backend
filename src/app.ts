import express from 'express';
import cors from 'cors';
import { env, isProduction } from './config/env';
import { connectDB } from './config/database';
import { errorHandler } from './middleware/errorHandler';
import { readMeter } from './middleware/readMeter';
import { authorizeByPolicy, whoAmI } from './middleware/auth';
import { aiRateLimit } from './middleware/rateLimits';

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
// Only origins this project controls. Firebase site names and project ids are globally unique,
// so these patterns cannot be claimed by someone else (unlike a bare `*.web.app` match).
const ownedOriginPatterns = [
  /^https:\/\/(www\.)?attarwalaopticalhouse\.com$/,
  /^https:\/\/(attarwala-46200|attarwala-admin)(--[a-z0-9-]+)?\.(web\.app|firebaseapp\.com)$/,
  /^https:\/\/[a-z0-9-]+--attarwala-46200\.[a-z0-9-]+\.hosted\.app$/,
];
const localOrigin = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

app.use(
  cors({
    origin: (origin, callback) => {
      // No Origin header: server-to-server calls (Next.js SSR, NextAuth, cron, curl).
      if (!origin) return callback(null, true);
      // localhost is dev-only, even if CORS_ORIGIN lists it.
      if (localOrigin.test(origin)) return callback(null, !isProduction());
      if (allowedOrigins.includes(origin)) return callback(null, true);
      if (ownedOriginPatterns.some((re) => re.test(origin))) return callback(null, true);
      // Capacitor app loads the live site, but keep its native origins working too.
      if (origin === 'capacitor://localhost' || origin === 'https://localhost') return callback(null, true);
      return callback(null, false);
    },
    credentials: true,
  })
);

// Razorpay webhook must receive raw body for signature verification
app.post('/api/razorpay/webhook', express.raw({ type: 'application/json' }), handleWebhook);
app.post('/razorpay/webhook', express.raw({ type: 'application/json' }), handleWebhook);

app.use(express.json());

// Count Firestore document reads per request and log the expensive ones ([FS-READS])
app.use(readMeter);

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

// Storefront-facing routes (their handlers do their own customer/admin checks)
apiRouter.use('/public', publicRoutes);
apiRouter.use('/auth',   authRoutes);
apiRouter.use('/razorpay', razorpayRoutes);

// Signed-in admin/staff user and role (the admin app calls this after Google sign-in)
apiRouter.get('/me', whoAmI);

// Everything else needs a Firebase ID token for an admin or staff user; the access policy
// (middleware/accessPolicy.ts) decides which role each method + path needs.
const adminRouter = express.Router();
adminRouter.use(authorizeByPolicy);
adminRouter.use('/ai', aiRateLimit);
adminRouter.use('/customers', customerRoutes);
adminRouter.use('/optical-numbers', opticalNumberRoutes); // legacy — kept for backward compat
adminRouter.use('/optical-lenses', opticalLensRoutes);
adminRouter.use('/prescriptions', prescriptionRoutes);
adminRouter.use('/fragrances', fragranceRoutes);
adminRouter.use('/frames', frameRoutes);
adminRouter.use('/invoice-items', invoiceItemRoutes);
adminRouter.use('/invoices', invoiceRoutes);
adminRouter.use('/analytics', analyticsRoutes);
adminRouter.use('/dashboard', dashboardRoutes);
adminRouter.use('/cashflow', cashflowRoutes);
adminRouter.use('/expenses', expenseRoutes);
adminRouter.use('/vendor-bills', vendorBillRoutes);
adminRouter.use('/payments', paymentsRoutes);
adminRouter.use('/sales', salesRoutes);
adminRouter.use('/inventory', inventoryIntelligenceRoutes);
adminRouter.use('/personal-expenses', personalExpenseRoutes);
adminRouter.use('/monthly-targets', monthlyTargetRoutes);
adminRouter.use('/coatings', coatingRoutes);
adminRouter.use('/lens-pricing', lensPricingRoutes);
adminRouter.use('/lens-stock', lensStockRoutes);
adminRouter.use('/frame-companies', frameCompanyRoutes);
adminRouter.use('/frame-stock', frameStockRoutes);
adminRouter.use('/frame-colors', frameColorRoutes);
adminRouter.use('/marketing', marketingRoutes);
adminRouter.use('/campaigns', campaignRoutes);
adminRouter.use('/automation', automationRoutes);
adminRouter.use('/lost-sales', lostSaleRoutes);
adminRouter.use('/saving-goals', savingGoalRoutes);
adminRouter.use('/recurring-expenses', recurringExpenseRoutes);
adminRouter.use('/contact-lenses', contactLensRoutes);
adminRouter.use('/settings', siteSettingRoutes);
adminRouter.use('/blog', blogRoutes);
adminRouter.use('/notifications', notificationRoutes);
adminRouter.use('/debts', debtRoutes);
adminRouter.use('/commitments', commitmentRoutes);
adminRouter.use('/debt-config', debtConfigRoutes);
adminRouter.use('/debt-payments', debtPaymentRoutes);
adminRouter.use('/obligations', obligationRoutes);
adminRouter.use('/obligation-payments', obligationPaymentRoutes);
adminRouter.use('/finance', financeOverviewRoutes);
adminRouter.use('/reports', lensReorderRoutes);
adminRouter.use('/purchases', purchaseEntryRoutes);
adminRouter.use('/wholesaler-queue', wholesalerQueueRoutes);
adminRouter.use('/customer-requirements', customerRequirementRoutes);
adminRouter.use('/ai', aiChatRoutes);
apiRouter.use(adminRouter);

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
