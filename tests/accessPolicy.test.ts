import { describe, it, expect } from 'vitest';
import { requiredRole } from '../src/middleware/accessPolicy';

describe('access policy', () => {
  it.each([
    ['POST', '/invoices'],
    ['GET', '/invoices/merged'],
    ['PATCH', '/invoices/abc/payment'],
    ['PUT', '/invoices/abc'],
    ['POST', '/invoices/demand'],
    ['GET', '/invoices/today-excel'],
    ['POST', '/customers'],
    ['POST', '/prescriptions'],
    ['POST', '/frames'],
    ['PUT', '/frames/f1'],
    ['POST', '/frame-stock'],
    ['PATCH', '/lens-stock/l1/adjust'],
    ['POST', '/frame-companies'],
    ['GET', '/coatings'],
    ['GET', '/lens-pricing/lookup'],
    ['POST', '/lens-pricing/match'],
    ['POST', '/wholesaler-queue/direct-order'],
    ['DELETE', '/wholesaler-queue/q1'],
    ['POST', '/purchases/batch'],
    ['PATCH', '/customer-requirements/r1/status'],
    ['DELETE', '/notifications/fcm-token'],
    ['GET', '/reports/lens-reorder'],
    ['GET', '/dashboard/recalls'],
    ['POST', '/dashboard/recalls/mark-sent'],
    ['GET', '/dashboard/daily-tasks'],
  ])('staff may %s %s', (m, p) => expect(requiredRole(m, p)).toBe('staff'));

  it.each([
    ['GET', '/analytics/sales'],
    ['GET', '/dashboard/daily'],
    ['GET', '/dashboard/financial-intelligence'],
    ['POST', '/expenses'],
    ['GET', '/cashflow'],
    ['GET', '/finance/overview'],
    ['GET', '/marketing/segments'],
    ['POST', '/ai/data-chat'],
    ['PUT', '/settings/instagram_limit'],
    ['GET', '/lost-sales'],
    ['DELETE', '/invoices/abc'],
    ['DELETE', '/invoices/abc/payment/0'],
    ['DELETE', '/invoices/abc/items/1'],
    ['PATCH', '/invoices/abc/payment/0'],
    ['POST', '/invoices/renumber'],
    ['DELETE', '/customers/c1'],
    ['PATCH', '/frames/f1/archive'],
    ['GET', '/frames/sold'],
    ['GET', '/fragrances/revenue-summary'],
    ['GET', '/optical-lenses/analytics'],
    ['POST', '/coatings'],
    ['POST', '/lens-pricing'],
    ['PUT', '/lens-pricing/r1'],
    ['POST', '/lens-pricing/seed-enterprise'],
    ['PUT', '/frame-companies/c1'],
    ['DELETE', '/wholesaler-queue'],
    ['POST', '/purchases/clear-all'],
    ['GET', '/me-not-a-route'],
  ])('admin only: %s %s', (m, p) => expect(requiredRole(m, p)).toBe('admin'));

  it('ignores a trailing slash and method case', () => {
    expect(requiredRole('post', '/invoices/')).toBe('staff');
  });
});
