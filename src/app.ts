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
import expenseRoutes from './routes/expense.routes';
import paymentsRoutes from './routes/payments.routes';
import vendorBillRoutes from './routes/vendorBill.routes';

const app = express();

// Middleware
const corsOrigin = env.NODE_ENV === 'development'
  ? (origin: string | undefined, cb: (e: Error | null, ok?: boolean) => void) => cb(null, true)
  : env.CORS_ORIGIN.split(',');
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
app.use('/api/expenses', expenseRoutes);
app.use('/api/payments', paymentsRoutes);
app.use('/api/vendor-bills', vendorBillRoutes);

// 404 handler
app.use((_req, res) => {
  res.status(404).json({ message: 'Route not found' });
});

// Global error handler
app.use(errorHandler);

export default app;
