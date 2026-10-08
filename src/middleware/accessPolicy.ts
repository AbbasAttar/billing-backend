/**
 * Who may call what on the admin/POS API. One table, so the rules can be read and tested in one place.
 *
 *   admin — everything.
 *   staff — counter work: billing and due collection, customers and prescriptions, stock and products,
 *           lab (wholesaler) orders, purchases inward, requirements, website order dispatch.
 *           Not: analytics, reports, expenses, finance, marketing, settings, website content, AI,
 *           deleting/archiving records, renumbering or editing past payments, pricing rules.
 *
 * Paths are relative to the API root (no "/api" prefix). Storefront routes (/public, /auth) and the
 * Razorpay customer endpoints are guarded separately and never reach this table.
 */
export type StaffRole = 'admin' | 'staff';

/** API areas staff may use (subject to ADMIN_ONLY below). Anything not listed is admin-only. */
const STAFF_AREAS = [
  'customers',
  'prescriptions',
  'optical-numbers',
  'invoices',
  'invoice-items',
  'frames',
  'frame-stock',
  'frame-companies',
  'frame-colors',
  'fragrances',
  'optical-lenses',
  'contact-lenses',
  'lens-stock',
  'lens-pricing',
  'coatings',
  'wholesaler-queue',
  'purchases',
  'customer-requirements',
  'notifications',
  'reports', // lens re-order suggestions only (GET /reports/lens-reorder)
];

/** Dashboard endpoints the counter home screen needs; the rest of /dashboard is business data. */
const STAFF_DASHBOARD = /^\/dashboard\/(recalls(\/.*)?|daily-tasks)$/;

/** Exceptions inside staff areas that still need an admin. [method regex, path regex] */
const ADMIN_ONLY: Array<[RegExp, RegExp]> = [
  // Deleting is admin-only, except routine counter corrections: cancelling one lab order, fixing a
  // wrong prescription, dismissing a pending purchase, removing a logged requirement, and
  // unregistering a device from notifications. (Removing lines from a saved invoice stays admin-only.)
  [/^DELETE$/, /^\/(?!(wholesaler-queue|prescriptions|purchases|customer-requirements)\/[^/]+$|notifications\/fcm-token$).*/],
  // Archiving products hides them from sale.
  [/^PATCH$/, /\/archive$/],
  // Invoice numbering and corrections to money already recorded.
  [/^POST$/, /^\/invoices\/renumber$/],
  [/^PATCH$/, /^\/invoices\/[^/]+\/payment\/[^/]+$/],
  // Sales performance data shown on analytics tabs.
  [/^GET$/, /^\/(frames|fragrances|lens-stock)\/(trends|sold|revenue-summary)$/],
  [/^GET$/, /^\/optical-lenses\/analytics$/],
  [/^GET$/, /^\/lens-pricing\/quote-history$/],
  // Pricing rules and coatings are configuration (staff may still look prices up via GET and POST /match).
  [/^(POST|PUT|PATCH)$/, /^\/coatings(\/.*)?$/],
  [/^(POST|PUT|PATCH)$/, /^\/lens-pricing(\/(?!match$).*)?$/],
  // Renaming shared reference data (staff may add new companies/colours while creating a product).
  [/^(PUT|PATCH)$/, /^\/(frame-companies|frame-colors)\/.+$/],
  // Purchase-ledger maintenance jobs.
  [/^(GET|POST|DELETE)$/, /^\/purchases\/(clear-all|legacy-summary|map-legacy|populate-all)$/],
];

/** Minimum role needed for `method path`. */
export function requiredRole(method: string, path: string): StaffRole {
  const m = method.toUpperCase();
  const p = path.replace(/\/+$/, '') || '/';

  if (m === 'GET' && STAFF_DASHBOARD.test(p)) return 'staff';
  if ((m === 'POST') && /^\/dashboard\/recalls\/(mark-sent|snooze)$/.test(p)) return 'staff';

  const area = p.split('/')[1] ?? '';
  if (!STAFF_AREAS.includes(area)) return 'admin';
  if (ADMIN_ONLY.some(([mr, pr]) => mr.test(m) && pr.test(p))) return 'admin';
  return 'staff';
}
