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

const app = express();

// Middleware
const corsOrigin = env.CORS_ORIGIN.split(',');
app.use(cors({ origin: corsOrigin, credentials: true }));
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

// 404 handler
app.use((_req, res) => {
  res.status(404).json({ message: 'Route not found' });
});

// Global error handler
app.use(errorHandler);

export default app;
