import { Customer } from '../models/Customer.model';
import { Expense } from '../models/Expense.model';
import { Frame } from '../models/Frame.model';
import { Fragrance } from '../models/Fragrance.model';
import { Invoice } from '../models/Invoice.model';
import { OpticalLens } from '../models/OpticalLens.model';
import { VendorBill } from '../models/VendorBill.model';

const DAY = 86400000;

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);
const safeDivide = (numerator: number, denominator: number) => (denominator > 0 ? numerator / denominator : 0);
const round = (value: number, digits = 2) => Number(value.toFixed(digits));

const startOfDay = (date: Date) => {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
};

const endOfDay = (date: Date) => {
  const copy = new Date(date);
  copy.setHours(23, 59, 59, 999);
  return copy;
};

const addDays = (date: Date, days: number) => {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy;
};

const diffInDays = (left: Date, right: Date) =>
  Math.ceil((startOfDay(left).getTime() - startOfDay(right).getTime()) / DAY);

const getInvoicePaidAmount = (invoice: any) =>
  Array.isArray(invoice.payments)
    ? invoice.payments.reduce((sum: number, payment: any) => sum + (Number(payment.amount) || 0), 0)
    : 0;

const getInvoiceBalance = (invoice: any) => Math.max((Number(invoice.total) || 0) - getInvoicePaidAmount(invoice), 0);

const normalizeDateKey = (date: Date) => startOfDay(date).toISOString();

const normalizeReferenceDate = (input?: Date) => {
  if (!input || Number.isNaN(input.getTime())) {
    return new Date();
  }

  return input;
};

const toSeverityRank = (severity: string) =>
  severity === 'critical' ? 0 : severity === 'warning' ? 1 : severity === 'opportunity' ? 2 : 3;

const toTitleCase = (value: string) =>
  value
    .replace(/([A-Z])/g, ' $1')
    .replace(/[_-]/g, ' ')
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());

type ProductCategory = 'frame' | 'opticalLens' | 'fragrance';

type ProductMetric = {
  productId: string;
  name: string;
  companyName?: string;
  category: ProductCategory;
  units: number;
  revenue: number;
  grossProfit: number;
  grossMargin: number;
  lastSoldAt: string | null;
  stock: number | null;
  inventorySignal: 'tracked' | 'catalog_only';
};

const productCategoryLabels: Record<ProductCategory, string> = {
  frame: 'Frames',
  opticalLens: 'Lenses',
  fragrance: 'Fragrances',
};

const extractProductMeta = (item: any) => {
  if (item?.frame) {
    return {
      productId: String(item.frame._id),
      name: item.frame.name || 'Frame',
      companyName: item.frame.companyName,
      category: 'frame' as ProductCategory,
      costPrice: typeof item.frame.costPrice === 'number' ? item.frame.costPrice : null,
      stock: typeof item.frame.stock === 'number' ? item.frame.stock : null,
    };
  }

  if (item?.opticalLens) {
    return {
      productId: String(item.opticalLens._id),
      name: item.opticalLens.name || item.lensName || 'Lens',
      companyName: item.opticalLens.brand || item.lensBrand,
      category: 'opticalLens' as ProductCategory,
      costPrice: typeof item.opticalLens.costPrice === 'number' ? item.opticalLens.costPrice : null,
      stock: typeof item.opticalLens.stock === 'number' ? item.opticalLens.stock : null,
    };
  }

  if (item?.fragrance) {
    return {
      productId: String(item.fragrance._id),
      name: item.fragrance.name || 'Fragrance',
      companyName: item.fragrance.companyName,
      category: 'fragrance' as ProductCategory,
      costPrice: typeof item.fragrance.costPrice === 'number' ? item.fragrance.costPrice : null,
      stock: typeof item.fragrance.stock === 'number' ? item.fragrance.stock : null,
    };
  }

  return null;
};

const estimateUnitCost = (unitPrice: number, explicitCost: number | null) => {
  if (typeof explicitCost === 'number' && explicitCost >= 0) {
    return explicitCost;
  }

  return unitPrice * 0.58;
};

const buildCustomerSegments = (customerMetrics: any[]) => {
  const counts = {
    vip: 0,
    loyal: 0,
    growing: 0,
    atRisk: 0,
    dormant: 0,
    priceSensitive: 0,
    slowPayer: 0,
  };

  for (const customer of customerMetrics) {
    const recencyDays = customer.recencyDays;
    const avgOrderValue = customer.averageOrderValue;
    const avgDiscountRate = customer.averageDiscountRate;
    const avgPaymentDelayDays = customer.averagePaymentDelayDays;

    if (recencyDays <= 30 && customer.totalRevenue >= 50000) {
      counts.vip += 1;
      continue;
    }

    if (customer.invoiceCount >= 4 && recencyDays <= 45) {
      counts.loyal += 1;
      continue;
    }

    if (customer.invoiceCount >= 2 && recencyDays <= 60 && customer.totalRevenue >= 15000) {
      counts.growing += 1;
      continue;
    }

    if (recencyDays > 120) {
      counts.dormant += 1;
      continue;
    }

    if (avgPaymentDelayDays > 20) {
      counts.slowPayer += 1;
      continue;
    }

    if (avgDiscountRate >= 0.12 || avgOrderValue < 2000) {
      counts.priceSensitive += 1;
      continue;
    }

    counts.atRisk += 1;
  }

  return Object.entries(counts).map(([segment, count]) => ({
    segment,
    label: toTitleCase(segment),
    count,
  }));
};

export const buildDashboardCommandCenter = async (referenceDateInput?: Date) => {
  const referenceDate = normalizeReferenceDate(referenceDateInput);
  const today = startOfDay(referenceDate);
  const currentStart = startOfDay(addDays(today, -29));
  const previousStart = startOfDay(addDays(currentStart, -30));
  const previousEnd = endOfDay(addDays(currentStart, -1));
  const historyStart = startOfDay(addDays(today, -179));
  const deepHistoryStart = startOfDay(addDays(today, -364));
  const nowEnd = endOfDay(today);

  const [
    historicalInvoices,
    allInvoicesLite,
    openInvoices,
    expenses,
    vendorBills,
    customersCount,
    frames,
    fragrances,
    opticalLenses,
  ] = await Promise.all([
    Invoice.find({ billDate: { $gte: historyStart, $lte: nowEnd } })
      .populate('customer', 'name mobileNumber')
      .populate({
        path: 'items',
        populate: [
          { path: 'frame', select: 'name companyName type costPrice sellPrice stock' },
          { path: 'opticalLens', select: 'name brand category costPrice sellPrice stock' },
          { path: 'fragrance', select: 'name companyName type costPrice sellPrice stock' },
        ],
      })
      .lean(),
    Invoice.find({ billDate: { $gte: deepHistoryStart, $lte: nowEnd } })
      .select({ customer: 1, total: 1, discount: 1, billDate: 1, billClearDate: 1, payments: 1 })
      .populate('customer', 'name mobileNumber')
      .lean(),
    Invoice.find({ billClearDate: null })
      .select({ customer: 1, total: 1, discount: 1, billDate: 1, payments: 1 })
      .populate('customer', 'name mobileNumber')
      .lean(),
    Expense.find({ date: { $gte: historyStart, $lte: nowEnd }, isVoid: false }).lean(),
    VendorBill.find().lean(),
    Customer.countDocuments(),
    Frame.find().lean(),
    Fragrance.find().lean(),
    OpticalLens.find().lean(),
  ]);

  const currentInvoices = historicalInvoices.filter((invoice: any) => {
    const billDate = new Date(String(invoice.billDate));
    return billDate >= currentStart && billDate <= nowEnd;
  });

  const previousInvoices = historicalInvoices.filter((invoice: any) => {
    const billDate = new Date(String(invoice.billDate));
    return billDate >= previousStart && billDate <= previousEnd;
  });

  const currentExpenses = expenses.filter((expense: any) => {
    const date = new Date(String(expense.date));
    return date >= currentStart && date <= nowEnd;
  });

  const previousExpenses = expenses.filter((expense: any) => {
    const date = new Date(String(expense.date));
    return date >= previousStart && date <= previousEnd;
  });

  const currentVendorPayments = vendorBills.reduce((sum: number, bill: any) => {
    const billPayments = Array.isArray(bill.payments) ? bill.payments : [];
    return (
      sum +
      billPayments.reduce((billSum: number, payment: any) => {
        const paymentDate = new Date(String(payment.date));
        if (paymentDate >= currentStart && paymentDate <= nowEnd) {
          return billSum + (Number(payment.amount) || 0);
        }

        return billSum;
      }, 0)
    );
  }, 0);

  const previousVendorPayments = vendorBills.reduce((sum: number, bill: any) => {
    const billPayments = Array.isArray(bill.payments) ? bill.payments : [];
    return (
      sum +
      billPayments.reduce((billSum: number, payment: any) => {
        const paymentDate = new Date(String(payment.date));
        if (paymentDate >= previousStart && paymentDate <= previousEnd) {
          return billSum + (Number(payment.amount) || 0);
        }

        return billSum;
      }, 0)
    );
  }, 0);

  const currentRevenue = currentInvoices.reduce((sum: number, invoice: any) => sum + (Number(invoice.total) || 0), 0);
  const previousRevenue = previousInvoices.reduce((sum: number, invoice: any) => sum + (Number(invoice.total) || 0), 0);

  const currentCollections = currentInvoices.reduce((sum: number, invoice: any) => {
    const payments = Array.isArray(invoice.payments) ? invoice.payments : [];
    return (
      sum +
      payments.reduce((paymentSum: number, payment: any) => {
        const paymentDate = new Date(String(payment.date));
        if (paymentDate >= currentStart && paymentDate <= nowEnd) {
          return paymentSum + (Number(payment.amount) || 0);
        }

        return paymentSum;
      }, 0)
    );
  }, 0);

  const previousCollections = previousInvoices.reduce((sum: number, invoice: any) => {
    const payments = Array.isArray(invoice.payments) ? invoice.payments : [];
    return (
      sum +
      payments.reduce((paymentSum: number, payment: any) => {
        const paymentDate = new Date(String(payment.date));
        if (paymentDate >= previousStart && paymentDate <= previousEnd) {
          return paymentSum + (Number(payment.amount) || 0);
        }

        return paymentSum;
      }, 0)
    );
  }, 0);

  const currentExpenseTotal = currentExpenses.reduce((sum: number, expense: any) => sum + (Number(expense.amount) || 0), 0);
  const previousExpenseTotal = previousExpenses.reduce((sum: number, expense: any) => sum + (Number(expense.amount) || 0), 0);

  const trendMap = new Map<string, { date: string; revenue: number; collections: number; grossProfit: number }>();
  for (let day = 0; day < 30; day += 1) {
    const date = startOfDay(addDays(currentStart, day));
    trendMap.set(normalizeDateKey(date), {
      date: date.toISOString(),
      revenue: 0,
      collections: 0,
      grossProfit: 0,
    });
  }

  const categoryTotals = new Map<ProductCategory, { revenue: number; grossProfit: number; units: number }>();
  const currentProductMap = new Map<string, ProductMetric>();
  const recentProductMap = new Map<string, ProductMetric>();
  const invoicePairs = new Map<string, { left: string; right: string; count: number }>();

  const recordProductMetric = (target: Map<string, ProductMetric>, meta: ReturnType<typeof extractProductMeta>, item: any, invoiceDate: Date) => {
    if (!meta) return;

    const revenue = (Number(item.price) || 0) * (Number(item.quantity) || 0);
    const unitCost = estimateUnitCost(Number(item.price) || 0, meta.costPrice);
    const grossProfit = revenue - unitCost * (Number(item.quantity) || 0);
    const existing = target.get(meta.productId);

    if (existing) {
      existing.units += Number(item.quantity) || 0;
      existing.revenue += revenue;
      existing.grossProfit += grossProfit;
      existing.lastSoldAt = existing.lastSoldAt && new Date(existing.lastSoldAt) > invoiceDate
        ? existing.lastSoldAt
        : invoiceDate.toISOString();
      existing.grossMargin = safeDivide(existing.grossProfit, existing.revenue);
      if (existing.stock == null && meta.stock != null) {
        existing.stock = meta.stock;
        existing.inventorySignal = 'tracked';
      }
      return;
    }

    target.set(meta.productId, {
      productId: meta.productId,
      name: meta.name,
      companyName: meta.companyName,
      category: meta.category,
      units: Number(item.quantity) || 0,
      revenue,
      grossProfit,
      grossMargin: safeDivide(grossProfit, revenue),
      lastSoldAt: invoiceDate.toISOString(),
      stock: meta.stock,
      inventorySignal: meta.stock == null ? 'catalog_only' : 'tracked',
    });
  };

  for (const invoice of historicalInvoices as any[]) {
    const invoiceDate = new Date(String(invoice.billDate));
    const dayKey = normalizeDateKey(invoiceDate);
    const trendEntry = trendMap.get(dayKey);
    const payments = Array.isArray(invoice.payments) ? invoice.payments : [];

    if (trendEntry) {
      trendEntry.revenue += Number(invoice.total) || 0;
      trendEntry.collections += payments.reduce((sum: number, payment: any) => {
        const paymentDate = new Date(String(payment.date));
        return paymentDate >= currentStart && paymentDate <= nowEnd ? sum + (Number(payment.amount) || 0) : sum;
      }, 0);
    }

    const items = Array.isArray(invoice.items) ? invoice.items : [];
    const invoiceProductIds = new Set<string>();

    for (const item of items) {
      const meta = extractProductMeta(item);
      if (!meta) continue;

      recordProductMetric(recentProductMap, meta, item, invoiceDate);

      if (invoiceDate >= currentStart && invoiceDate <= nowEnd) {
        recordProductMetric(currentProductMap, meta, item, invoiceDate);
        const categoryTotal = categoryTotals.get(meta.category) ?? { revenue: 0, grossProfit: 0, units: 0 };
        const revenue = (Number(item.price) || 0) * (Number(item.quantity) || 0);
        const unitCost = estimateUnitCost(Number(item.price) || 0, meta.costPrice);
        const grossProfit = revenue - unitCost * (Number(item.quantity) || 0);
        categoryTotal.revenue += revenue;
        categoryTotal.grossProfit += grossProfit;
        categoryTotal.units += Number(item.quantity) || 0;
        categoryTotals.set(meta.category, categoryTotal);

        if (trendEntry) {
          trendEntry.grossProfit += grossProfit;
        }
      }

      invoiceProductIds.add(meta.productId);
    }

    if (invoiceDate >= addDays(today, -89) && invoiceProductIds.size > 1) {
      const productIds = [...invoiceProductIds].sort();
      for (let leftIndex = 0; leftIndex < productIds.length; leftIndex += 1) {
        for (let rightIndex = leftIndex + 1; rightIndex < productIds.length; rightIndex += 1) {
          const left = productIds[leftIndex];
          const right = productIds[rightIndex];
          const pairKey = `${left}::${right}`;
          const currentPair = invoicePairs.get(pairKey);
          if (currentPair) {
            currentPair.count += 1;
          } else {
            invoicePairs.set(pairKey, { left, right, count: 1 });
          }
        }
      }
    }
  }

  const currentProducts = [...currentProductMap.values()].sort((left, right) => right.revenue - left.revenue);
  const recentProducts = [...recentProductMap.values()];
  const currentGrossProfit = currentProducts.reduce((sum, product) => sum + product.grossProfit, 0);
  const previousGrossProfit = previousInvoices.reduce((sum: number, invoice: any) => {
    const items = Array.isArray(invoice.items) ? invoice.items : [];
    return (
      sum +
      items.reduce((itemSum: number, item: any) => {
        const meta = extractProductMeta(item);
        if (!meta) return itemSum;
        const revenue = (Number(item.price) || 0) * (Number(item.quantity) || 0);
        const unitCost = estimateUnitCost(Number(item.price) || 0, meta.costPrice);
        return itemSum + (revenue - unitCost * (Number(item.quantity) || 0));
      }, 0)
    );
  }, 0);

  const grossMargin = safeDivide(currentGrossProfit, currentRevenue);
  const previousGrossMargin = safeDivide(previousGrossProfit, previousRevenue);
  const outstandingReceivables = openInvoices.reduce((sum: number, invoice: any) => sum + getInvoiceBalance(invoice), 0);
  const overdueReceivables = openInvoices.reduce((sum: number, invoice: any) => {
    const ageDays = diffInDays(today, new Date(String(invoice.billDate)));
    return ageDays > 30 ? sum + getInvoiceBalance(invoice) : sum;
  }, 0);

  const customerMap = new Map<string, any>();
  for (const invoice of allInvoicesLite as any[]) {
    const customer = invoice.customer as any;
    if (!customer?._id) continue;

    const customerId = String(customer._id);
    const existing = customerMap.get(customerId) ?? {
      customerId,
      name: customer.name || 'Customer',
      invoiceCount: 0,
      totalRevenue: 0,
      totalOutstanding: 0,
      totalDiscount: 0,
      billDates: [] as Date[],
      paymentDelaySamples: [] as number[],
    };

    existing.invoiceCount += 1;
    existing.totalRevenue += Number(invoice.total) || 0;
    existing.totalOutstanding += getInvoiceBalance(invoice);
    existing.totalDiscount += Number(invoice.discount) || 0;
    existing.billDates.push(new Date(String(invoice.billDate)));

    if (invoice.billClearDate) {
      existing.paymentDelaySamples.push(diffInDays(new Date(String(invoice.billClearDate)), new Date(String(invoice.billDate))));
    }

    customerMap.set(customerId, existing);
  }

  const customerMetrics = [...customerMap.values()].map((entry) => {
    const billDates = entry.billDates.sort((left: Date, right: Date) => left.getTime() - right.getTime());
    const lastPurchaseDate = billDates[billDates.length - 1];
    const firstPurchaseDate = billDates[0];
    const gaps: number[] = [];

    for (let index = 1; index < billDates.length; index += 1) {
      gaps.push(diffInDays(billDates[index], billDates[index - 1]));
    }

    const averageGapDays = gaps.length ? gaps.reduce((sum, gap) => sum + gap, 0) / gaps.length : 45;
    const averagePaymentDelayDays = entry.paymentDelaySamples.length
      ? entry.paymentDelaySamples.reduce((sum: number, sample: number) => sum + sample, 0) / entry.paymentDelaySamples.length
      : 0;
    const recencyDays = diffInDays(today, lastPurchaseDate);
    const churnScore = clamp(Math.round((recencyDays / Math.max(averageGapDays || 30, 15)) * 35 + averagePaymentDelayDays * 1.5 + (entry.totalOutstanding > 0 ? 12 : 0)), 0, 100);

    return {
      customerId: entry.customerId,
      name: entry.name,
      invoiceCount: entry.invoiceCount,
      totalRevenue: round(entry.totalRevenue),
      totalOutstanding: round(entry.totalOutstanding),
      averageOrderValue: round(safeDivide(entry.totalRevenue, entry.invoiceCount)),
      averageDiscountRate: safeDivide(entry.totalDiscount, Math.max(entry.totalRevenue + entry.totalDiscount, 1)),
      averagePaymentDelayDays: round(averagePaymentDelayDays),
      averageGapDays: round(averageGapDays),
      recencyDays,
      churnScore,
      lastPurchaseDate: lastPurchaseDate.toISOString(),
      firstPurchaseDate: firstPurchaseDate.toISOString(),
      lifetimeValue: round(entry.totalRevenue),
      loyaltyScore: clamp(Math.round(100 - recencyDays * 0.65 + entry.invoiceCount * 6 + safeDivide(entry.totalRevenue, 1000)), 0, 100),
    };
  });

  const repeatCustomers = customerMetrics.filter((customer) => customer.invoiceCount >= 2).length;
  const repeatRate = safeDivide(repeatCustomers, Math.max(customerMetrics.length, 1));
  const activeCurrentCustomers = new Set(
    currentInvoices
      .map((invoice: any) => invoice.customer?._id ? String(invoice.customer._id) : null)
      .filter(Boolean)
  );
  const previousActiveCustomers = new Set(
    previousInvoices
      .map((invoice: any) => invoice.customer?._id ? String(invoice.customer._id) : null)
      .filter(Boolean)
  );
  const retainedCustomers = [...activeCurrentCustomers].filter((customerId) => {
    const customer = customerMetrics.find((metric) => metric.customerId === customerId);
    return customer ? new Date(customer.firstPurchaseDate) < currentStart : false;
  }).length;
  const retentionRate = safeDivide(retainedCustomers, Math.max(previousActiveCustomers.size, 1));

  const atRiskCustomers = customerMetrics
    .filter((customer) => customer.invoiceCount >= 2 && (customer.recencyDays > Math.max(customer.averageGapDays * 1.6, 45) || customer.churnScore >= 65))
    .sort((left, right) => right.churnScore - left.churnScore)
    .slice(0, 6)
    .map((customer) => ({
      customerId: customer.customerId,
      name: customer.name,
      churnScore: customer.churnScore,
      lastPurchaseDate: customer.lastPurchaseDate,
      daysSinceLastPurchase: customer.recencyDays,
      lifetimeValue: customer.lifetimeValue,
      averageGapDays: customer.averageGapDays,
      recommendation: customer.totalOutstanding > 0 ? 'Follow up on payment and offer assistance.' : 'Reach out with a targeted reorder or loyalty offer.',
    }));

  const customerSegments = buildCustomerSegments(customerMetrics);

  const collectionEfficiency = safeDivide(currentCollections, currentRevenue);
  const salesMomentumScore = clamp(Math.round((safeDivide(currentRevenue - previousRevenue, Math.max(previousRevenue, 1)) * 100 + 100) / 2), 0, 100);
  const marginScore = clamp(Math.round(grossMargin * 100 * 1.25), 0, 100);
  const receivableRiskScore = clamp(Math.round((1 - safeDivide(overdueReceivables, Math.max(outstandingReceivables, 1))) * 100), 0, 100);
  const retentionScore = clamp(Math.round(retentionRate * 100), 0, 100);
  const cashBufferScore = clamp(Math.round(100 - safeDivide(currentExpenseTotal + currentVendorPayments, Math.max(currentCollections, 1)) * 100 + 35), 0, 100);
  const healthScore = Math.round(
    salesMomentumScore * 0.22 +
    marginScore * 0.22 +
    Math.round(collectionEfficiency * 100) * 0.2 +
    receivableRiskScore * 0.14 +
    retentionScore * 0.12 +
    cashBufferScore * 0.1
  );

  const receivablesAging = [
    { bucket: '0-7 days', min: 0, max: 7, amount: 0, invoices: 0 },
    { bucket: '8-15 days', min: 8, max: 15, amount: 0, invoices: 0 },
    { bucket: '16-30 days', min: 16, max: 30, amount: 0, invoices: 0 },
    { bucket: '31-60 days', min: 31, max: 60, amount: 0, invoices: 0 },
    { bucket: '60+ days', min: 61, max: Number.POSITIVE_INFINITY, amount: 0, invoices: 0 },
  ];

  const followUpInvoices = openInvoices
    .map((invoice: any) => {
      const ageDays = diffInDays(today, new Date(String(invoice.billDate)));
      const balance = getInvoiceBalance(invoice);
      const customer = invoice.customer as any;

      for (const bucket of receivablesAging) {
        if (ageDays >= bucket.min && ageDays <= bucket.max) {
          bucket.amount += balance;
          bucket.invoices += 1;
          break;
        }
      }

      return {
        invoiceId: String(invoice._id),
        customerName: customer?.name || 'Customer',
        billDate: new Date(String(invoice.billDate)).toISOString(),
        ageDays,
        outstanding: round(balance),
        paymentStatus: balance === 0 ? 'paid' : ageDays > 30 ? 'overdue' : 'open',
      };
    })
    .filter((invoice) => invoice.outstanding > 0)
    .sort((left, right) => right.ageDays - left.ageDays || right.outstanding - left.outstanding)
    .slice(0, 8);

  const expenseBreakdownMap = new Map<string, number>();
  for (const expense of currentExpenses as any[]) {
    expenseBreakdownMap.set(expense.category, (expenseBreakdownMap.get(expense.category) ?? 0) + (Number(expense.amount) || 0));
  }
  const expenseBreakdown = [...expenseBreakdownMap.entries()]
    .map(([category, amount]) => ({ category, amount: round(amount), share: round(safeDivide(amount, Math.max(currentExpenseTotal, 1)), 4) }))
    .sort((left, right) => right.amount - left.amount);

  const payablesDue = vendorBills
    .map((bill: any) => {
      const balance = Math.max((Number(bill.totalAmount) || 0) - (Number(bill.paidAmount) || 0), 0);
      const dueDate = new Date(String(bill.dueDate));
      const daysUntilDue = diffInDays(dueDate, today);
      const priorityScore = clamp(Math.round((daysUntilDue < 0 ? 70 : Math.max(0, 30 - daysUntilDue) * 2) + safeDivide(balance, Math.max(currentRevenue, 1)) * 1000), 0, 100);

      return {
        billId: String(bill._id),
        vendorName: bill.vendorName,
        category: bill.category,
        dueDate: dueDate.toISOString(),
        daysUntilDue,
        balance: round(balance),
        priorityScore,
        recommendation: daysUntilDue < 0 ? 'pay_now' : daysUntilDue <= 3 ? 'prioritize' : 'schedule',
      };
    })
    .filter((bill) => bill.balance > 0)
    .sort((left, right) => right.priorityScore - left.priorityScore || left.daysUntilDue - right.daysUntilDue);

  const categoryMix = (['frame', 'opticalLens', 'fragrance'] as ProductCategory[]).map((category) => {
    const totals = categoryTotals.get(category) ?? { revenue: 0, grossProfit: 0, units: 0 };
    return {
      category,
      label: productCategoryLabels[category],
      revenue: round(totals.revenue),
      grossProfit: round(totals.grossProfit),
      units: round(totals.units),
      share: round(safeDivide(totals.revenue, Math.max(currentRevenue, 1)), 4),
      growth: round(
        safeDivide(
          totals.revenue -
            previousInvoices.reduce((sum: number, invoice: any) => {
              const items = Array.isArray(invoice.items) ? invoice.items : [];
              return (
                sum +
                items.reduce((itemSum: number, item: any) => {
                  const meta = extractProductMeta(item);
                  if (!meta || meta.category !== category) return itemSum;
                  return itemSum + (Number(item.price) || 0) * (Number(item.quantity) || 0);
                }, 0)
              );
            }, 0),
          Math.max(
            previousInvoices.reduce((sum: number, invoice: any) => {
              const items = Array.isArray(invoice.items) ? invoice.items : [];
              return (
                sum +
                items.reduce((itemSum: number, item: any) => {
                  const meta = extractProductMeta(item);
                  if (!meta || meta.category !== category) return itemSum;
                  return itemSum + (Number(item.price) || 0) * (Number(item.quantity) || 0);
                }, 0)
              );
            }, 0),
            1
          )
        ) * 100
      ),
    };
  });

  const productCatalog = [
    ...frames.map((frame: any) => ({
      productId: String(frame._id),
      name: frame.name,
      companyName: frame.companyName,
      category: 'frame' as ProductCategory,
      stock: typeof frame.stock === 'number' ? frame.stock : null,
    })),
    ...opticalLenses.map((lens: any) => ({
      productId: String(lens._id),
      name: lens.name,
      companyName: lens.brand,
      category: 'opticalLens' as ProductCategory,
      stock: typeof lens.stock === 'number' ? lens.stock : null,
    })),
    ...fragrances.map((fragrance: any) => ({
      productId: String(fragrance._id),
      name: fragrance.name,
      companyName: fragrance.companyName,
      category: 'fragrance' as ProductCategory,
      stock: typeof fragrance.stock === 'number' ? fragrance.stock : null,
    })),
  ];

  const deadStock = productCatalog
    .map((product) => {
      const recentMetric = recentProductMap.get(product.productId);
      const daysSinceLastSale = recentMetric?.lastSoldAt ? diffInDays(today, new Date(recentMetric.lastSoldAt)) : 999;
      return {
        productId: product.productId,
        name: product.name,
        companyName: product.companyName,
        category: product.category,
        stock: product.stock,
        daysSinceLastSale,
        revenueLast180Days: round(recentMetric?.revenue ?? 0),
        inventorySignal: product.stock == null ? 'catalog_only' : 'tracked',
      };
    })
    .filter((product) => product.daysSinceLastSale > 60)
    .sort((left, right) => right.daysSinceLastSale - left.daysSinceLastSale)
    .slice(0, 6);

  const crossSellRecommendations = [...invoicePairs.values()]
    .map((pair) => {
      const left = recentProductMap.get(pair.left);
      const right = recentProductMap.get(pair.right);
      if (!left || !right) return null;
      return {
        primaryProductId: left.productId,
        primaryProductName: left.name,
        secondaryProductId: right.productId,
        secondaryProductName: right.name,
        pairFrequency: pair.count,
      };
    })
    .filter(Boolean)
    .sort((left: any, right: any) => right.pairFrequency - left.pairFrequency)
    .slice(0, 5);

  const netCashPosition = round(currentCollections - currentExpenseTotal - currentVendorPayments);
  const operatingMargin = safeDivide(currentGrossProfit - currentExpenseTotal, Math.max(currentRevenue, 1));
  const averageOrderValue = safeDivide(currentRevenue, Math.max(currentInvoices.length, 1));
  const purchaseFrequency = safeDivide(currentInvoices.length, Math.max(activeCurrentCustomers.size, 1));

  const actionQueue = {
    followUpInvoices,
    atRiskCustomers,
    payables: payablesDue.slice(0, 6),
    deadStock,
  };

  const insights: Array<{
    id: string;
    domain: 'sales' | 'customer' | 'inventory' | 'finance';
    severity: 'info' | 'warning' | 'critical' | 'opportunity';
    title: string;
    summary: string;
    evidence: string[];
    impactType: 'revenue' | 'cash' | 'margin' | 'retention' | 'stock';
    impactEstimate?: number;
    confidence: number;
    recommendedAction: string;
    actionDeadline?: string;
    relatedEntityIds?: string[];
  }> = [];

  const revenueDelta = safeDivide(currentRevenue - previousRevenue, Math.max(previousRevenue, 1)) * 100;
  if (revenueDelta <= -10) {
    insights.push({
      id: 'sales-drop',
      domain: 'sales',
      severity: 'warning',
      title: 'Sales momentum has softened',
      summary: `Revenue is down ${Math.abs(round(revenueDelta, 1))}% versus the prior 30-day period.`,
      evidence: [
        `Current period revenue: Rs ${Math.round(currentRevenue).toLocaleString('en-IN')}`,
        `Previous period revenue: Rs ${Math.round(previousRevenue).toLocaleString('en-IN')}`,
      ],
      impactType: 'revenue',
      impactEstimate: round(previousRevenue - currentRevenue),
      confidence: 82,
      recommendedAction: 'Review underperforming categories and promote repeat-customer reactivation offers this week.',
    });
  }

  if (collectionEfficiency < 0.8) {
    insights.push({
      id: 'collections-risk',
      domain: 'finance',
      severity: overdueReceivables > outstandingReceivables * 0.35 ? 'critical' : 'warning',
      title: 'Collections are lagging billed revenue',
      summary: `Only ${Math.round(collectionEfficiency * 100)}% of this period's billed revenue has converted to collections.`,
      evidence: [
        `Outstanding receivables: Rs ${Math.round(outstandingReceivables).toLocaleString('en-IN')}`,
        `Overdue receivables: Rs ${Math.round(overdueReceivables).toLocaleString('en-IN')}`,
      ],
      impactType: 'cash',
      impactEstimate: round(outstandingReceivables),
      confidence: 88,
      recommendedAction: 'Prioritize payment follow-ups on invoices older than 15 days and monitor high-balance accounts daily.',
    });
  }

  if (atRiskCustomers.length > 0) {
    insights.push({
      id: 'churn-risk',
      domain: 'customer',
      severity: atRiskCustomers.length >= 4 ? 'warning' : 'info',
      title: 'High-value customers are drifting',
      summary: `${atRiskCustomers.length} repeat customers show elevated churn signals based on recency and buying cadence.`,
      evidence: atRiskCustomers.slice(0, 3).map((customer) => `${customer.name}: ${customer.daysSinceLastPurchase} days since last purchase`),
      impactType: 'retention',
      confidence: 76,
      recommendedAction: 'Launch a focused outreach list with reorder reminders, payment nudges, or loyalty offers.',
      relatedEntityIds: atRiskCustomers.map((customer) => customer.customerId),
    });
  }

  if (grossMargin < previousGrossMargin - 0.05) {
    insights.push({
      id: 'margin-compression',
      domain: 'sales',
      severity: 'warning',
      title: 'Margin has compressed',
      summary: `Gross margin is down from ${Math.round(previousGrossMargin * 100)}% to ${Math.round(grossMargin * 100)}%.`,
      evidence: [
        `Current gross profit: Rs ${Math.round(currentGrossProfit).toLocaleString('en-IN')}`,
        `Current revenue: Rs ${Math.round(currentRevenue).toLocaleString('en-IN')}`,
      ],
      impactType: 'margin',
      confidence: 73,
      recommendedAction: 'Review discount-heavy invoices and shift sales attention to stronger-margin products.',
    });
  }

  const strongestCategory = [...categoryMix].sort((left, right) => right.growth - left.growth)[0];
  if (strongestCategory && strongestCategory.growth >= 15) {
    insights.push({
      id: 'category-opportunity',
      domain: 'inventory',
      severity: 'opportunity',
      title: `${strongestCategory.label} are outperforming`,
      summary: `${strongestCategory.label} revenue is up ${round(strongestCategory.growth, 1)}% versus the previous period.`,
      evidence: [
        `Category revenue share: ${Math.round(strongestCategory.share * 100)}%`,
        `Units sold: ${strongestCategory.units.toLocaleString('en-IN')}`,
      ],
      impactType: 'revenue',
      confidence: 71,
      recommendedAction: 'Increase merchandising focus, restock proven winners, and highlight related bundles.',
    });
  }

  if (payablesDue[0] && payablesDue[0].priorityScore >= 70) {
    insights.push({
      id: 'vendor-priority',
      domain: 'finance',
      severity: payablesDue[0].daysUntilDue < 0 ? 'critical' : 'warning',
      title: 'Vendor payables need sequencing',
      summary: `${payablesDue.filter((bill) => bill.daysUntilDue <= 7).length} vendor bills need attention within 7 days.`,
      evidence: payablesDue.slice(0, 2).map((bill) => `${bill.vendorName}: Rs ${Math.round(bill.balance).toLocaleString('en-IN')} due in ${bill.daysUntilDue} days`),
      impactType: 'cash',
      confidence: 84,
      recommendedAction: 'Pay overdue or near-due critical vendors first, then schedule lower-risk balances around incoming collections.',
    });
  }

  insights.sort((left, right) => toSeverityRank(left.severity) - toSeverityRank(right.severity));

  const seasonalityMonths = Array.from({ length: 12 }, (_, index) => {
    const monthStart = new Date(today.getFullYear(), today.getMonth() - 11 + index, 1);
    const monthEnd = endOfDay(new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0));
    const monthRevenue = (allInvoicesLite as any[]).reduce((sum: number, invoice: any) => {
      const billDate = new Date(String(invoice.billDate));
      return billDate >= monthStart && billDate <= monthEnd ? sum + (Number(invoice.total) || 0) : sum;
    }, 0);
    return {
      month: monthStart.toISOString(),
      revenue: round(monthRevenue),
    };
  });

  const weekdayHeatmap = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((label, dayIndex) => {
    const invoicesForDay = (historicalInvoices as any[]).filter((invoice: any) => new Date(String(invoice.billDate)).getDay() === dayIndex);
    const revenue = invoicesForDay.reduce((sum: number, invoice: any) => sum + (Number(invoice.total) || 0), 0);
    return {
      day: label,
      revenue: round(revenue),
      invoices: invoicesForDay.length,
    };
  });

  return {
    generatedAt: new Date().toISOString(),
    period: {
      from: currentStart.toISOString(),
      to: nowEnd.toISOString(),
      compareFrom: previousStart.toISOString(),
      compareTo: previousEnd.toISOString(),
      days: 30,
    },
    overview: {
      healthScore,
      kpis: {
        revenue: round(currentRevenue),
        revenueDelta: round(revenueDelta, 1),
        grossMargin: round(grossMargin * 100, 1),
        grossMarginDelta: round((grossMargin - previousGrossMargin) * 100, 1),
        netCashPosition,
        outstandingReceivables: round(outstandingReceivables),
        stockRiskCount: deadStock.length,
        repeatCustomerRate: round(repeatRate * 100, 1),
      },
      healthBreakdown: [
        { label: 'Sales Momentum', value: salesMomentumScore },
        { label: 'Margin Strength', value: marginScore },
        { label: 'Collection Efficiency', value: Math.round(collectionEfficiency * 100) },
        { label: 'Receivable Quality', value: receivableRiskScore },
        { label: 'Retention Proxy', value: retentionScore },
        { label: 'Cash Buffer', value: cashBufferScore },
      ],
      trend: [...trendMap.values()].map((entry) => ({
        date: entry.date,
        revenue: round(entry.revenue),
        collections: round(entry.collections),
        grossProfit: round(entry.grossProfit),
      })),
      categoryMix,
      actionCounts: {
        invoicesToFollowUp: followUpInvoices.length,
        churnRiskCustomers: atRiskCustomers.length,
        payablesDue: payablesDue.filter((bill) => bill.daysUntilDue <= 7).length,
        deadStock: deadStock.length,
      },
    },
    insights,
    customerIntelligence: {
      summary: {
        totalCustomers: customersCount,
        activeCustomers: activeCurrentCustomers.size,
        repeatCustomerRate: round(repeatRate * 100, 1),
        averageOrderValue: round(averageOrderValue),
        purchaseFrequency: round(purchaseFrequency, 2),
        retentionRate: round(retentionRate * 100, 1),
        churnRiskCount: atRiskCustomers.length,
      },
      segments: customerSegments,
      topCustomers: customerMetrics
        .sort((left, right) => right.totalRevenue - left.totalRevenue)
        .slice(0, 6)
        .map((customer) => ({
          customerId: customer.customerId,
          name: customer.name,
          lifetimeValue: customer.lifetimeValue,
          invoiceCount: customer.invoiceCount,
          loyaltyScore: customer.loyaltyScore,
          outstanding: customer.totalOutstanding,
        })),
      atRiskCustomers,
    },
    productIntelligence: {
      summary: {
        activeProducts: currentProducts.length,
        topPerformerRevenue: round(currentProducts[0]?.revenue ?? 0),
        averageMargin: round(safeDivide(currentGrossProfit, Math.max(currentRevenue, 1)) * 100, 1),
        deadStockCount: deadStock.length,
        inventorySignal: productCatalog.some((product) => product.stock != null) ? 'partial_tracking' : 'catalog_only',
      },
      topSellers: currentProducts.slice(0, 6).map((product) => ({
        ...product,
        revenue: round(product.revenue),
        grossProfit: round(product.grossProfit),
        grossMargin: round(product.grossMargin * 100, 1),
      })),
      lowPerformers: [...currentProducts]
        .filter((product) => product.units > 0)
        .sort((left, right) => left.revenue - right.revenue)
        .slice(0, 6)
        .map((product) => ({
          ...product,
          revenue: round(product.revenue),
          grossProfit: round(product.grossProfit),
          grossMargin: round(product.grossMargin * 100, 1),
        })),
      highMarginProducts: [...currentProducts]
        .filter((product) => product.revenue > 0)
        .sort((left, right) => right.grossMargin - left.grossMargin)
        .slice(0, 6)
        .map((product) => ({
          ...product,
          revenue: round(product.revenue),
          grossProfit: round(product.grossProfit),
          grossMargin: round(product.grossMargin * 100, 1),
        })),
      deadStock,
      crossSellRecommendations,
    },
    financialIntelligence: {
      summary: {
        revenue: round(currentRevenue),
        collections: round(currentCollections),
        expenses: round(currentExpenseTotal),
        vendorPayments: round(currentVendorPayments),
        outstandingReceivables: round(outstandingReceivables),
        collectionEfficiency: round(collectionEfficiency * 100, 1),
        operatingMargin: round(operatingMargin * 100, 1),
        netCashPosition,
      },
      receivablesAging: receivablesAging.map((bucket) => ({
        bucket: bucket.bucket,
        amount: round(bucket.amount),
        invoices: bucket.invoices,
        share: round(safeDivide(bucket.amount, Math.max(outstandingReceivables, 1)) * 100, 1),
      })),
      expenseBreakdown,
      payablesDue: payablesDue.slice(0, 6),
      urgentReceivables: followUpInvoices.slice(0, 6),
    },
    seasonality: {
      monthlyTrend: seasonalityMonths,
      weekdayHeatmap,
    },
    actionQueue,
  };
};
