import { Invoice } from '../models/Invoice.model';
import { VendorBill } from '../models/VendorBill.model';
import { RecurringExpense, IRecurringExpense } from '../models/RecurringExpense.model';

export interface VendorQueueItem {
  vendorName: string;
  totalDue: number;
  priorityOrder: number;
  status: 'active_target' | 'queued' | 'cleared';
  targetMonth: string;
  category: 'frames' | 'fragrance' | 'lab' | 'repairs';
}

export interface ActiveObligationItem {
  id: string;
  name: string;
  category: string;
  monthlyAmount: number;
  weeklyAmount: number;
  isDebt: boolean;
  completionDate?: string;
  totalRepaymentAmount?: number;
  totalRepaidAmount?: number;
  repaymentStatus?: string;
}

export interface FinancialPlannerCommandData {
  generatedAt: string;
  weeklyVault: {
    dailyTarget: number;
    weeklyTarget: number;
    currentWeekCollected: number;
    currentWeekDaysElapsed: number;
    currentWeekDailyAvg: number;
    weekStartDate: string;
    weekEndDate: string;
    weeklyProgressPct: number;
    paceStatus: 'ahead' | 'on_track' | 'behind';
    breakdown: {
      fixedStoreOpex: number;    // Dynamic OpEx (Rent, Salaries, Light, Net)
      loan2Reserve: number;      // Dynamic Active Loans / Debts EMI
      vendorRepayment: number;   // ₹9,200/wk (₹40k/mo)
      rollingLabSupply: number;  // ₹3,500/wk (₹15k/mo)
    };
    activeObligations: ActiveObligationItem[];
  };
  allocationAdvisor: {
    todayCollected: number;
    step1VaultQuota: {
      amount: number;
      label: string;
      desc: string;
    };
    step2VendorQueue: VendorQueueItem[];
    step3RollingLab: {
      weeklyAmount: number;
      desc: string;
    };
    step4OwnerBuffer: {
      safeRetainedAmount: number;
      desc: string;
    };
  };
  onTrackAnalysis: {
    mtdSales: number;
    mtdTargetBreakEven: number;
    mtdDaysElapsed: number;
    mtdPaceStatus: 'profitable_surplus' | 'break_even_pace' | 'needs_attention';
    rolling7dDailyAvg: number;
    rolling30dDailyAvg: number;
    dailyTargetBenchmark: number;
    vendorDebtBurnDown: {
      initialBacklog: number;
      currentOutstanding: number;
      totalPaidOff: number;
      percentCleared: number;
      monthlyTargetRepayment: number;
      projectedFreedomDate: string;
    };
    activeDebtsCountdowns: Array<{
      name: string;
      monthlyEmi: number;
      expiryDate?: string;
      monthsRemaining?: number;
      totalRepaymentAmount?: number;
      totalRepaidAmount?: number;
      freedomMilestone?: string;
    }>;
    loan2Countdown: {
      monthlyEmi: number;
      expiryDate: string;
      monthsRemaining: number;
      freedomMilestone: string;
    };
  };
}

const toMonthlyAmount = (amount: number, frequency: string): number => {
  switch (frequency) {
    case 'daily': return amount * 30;
    case 'weekly': return Math.round((amount * 52) / 12);
    case 'monthly': return amount;
    case 'quarterly': return Math.round(amount / 3);
    case 'yearly': return Math.round(amount / 12);
    default: return amount;
  }
};

export const getFinancialPlannerData = async (referenceDate: Date = new Date()): Promise<FinancialPlannerCommandData> => {
  // Current Week (Monday to Sunday)
  const dayOfWeek = referenceDate.getDay(); // 0 is Sunday, 1 is Monday
  const diffToMon = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  const monday = new Date(referenceDate);
  monday.setDate(referenceDate.getDate() + diffToMon);
  monday.setHours(0, 0, 0, 0);

  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  sunday.setHours(23, 59, 59, 999);

  // Month-to-Date
  const monthStart = new Date(referenceDate.getFullYear(), referenceDate.getMonth(), 1, 0, 0, 0, 0);

  // 7 Days and 30 Days Ago
  const sevenDaysAgo = new Date(referenceDate);
  sevenDaysAgo.setDate(referenceDate.getDate() - 7);
  sevenDaysAgo.setHours(0, 0, 0, 0);

  const thirtyDaysAgo = new Date(referenceDate);
  thirtyDaysAgo.setDate(referenceDate.getDate() - 30);
  thirtyDaysAgo.setHours(0, 0, 0, 0);

  // Today start & end
  const todayStart = new Date(referenceDate);
  todayStart.setHours(0, 0, 0, 0);
  const todayEnd = new Date(referenceDate);
  todayEnd.setHours(23, 59, 59, 999);

  // Run Aggregations in Parallel with Live Recurring Expenses
  const [
    weekInvoices,
    mtdInvoices,
    last7dInvoices,
    last30dInvoices,
    todayInvoices,
    vendorBills,
    recurringExpenses,
  ] = await Promise.all([
    Invoice.find({ billDate: { $gte: monday, $lte: sunday } }).lean(),
    Invoice.find({ billDate: { $gte: monthStart, $lte: referenceDate } }).lean(),
    Invoice.find({ billDate: { $gte: sevenDaysAgo, $lte: referenceDate } }).lean(),
    Invoice.find({ billDate: { $gte: thirtyDaysAgo, $lte: referenceDate } }).lean(),
    Invoice.find({ billDate: { $gte: todayStart, $lte: todayEnd } }).lean(),
    VendorBill.find().lean(),
    RecurringExpense.find({ isActive: true }).lean(),
  ]);

  const sumTotal = (invs: any[]) =>
    invs.reduce((sum, inv) => sum + (Number(inv.total) || 0), 0);

  const weekCollected = sumTotal(weekInvoices);
  const mtdSales = sumTotal(mtdInvoices);
  const sales7d = sumTotal(last7dInvoices);
  const sales30d = sumTotal(last30dInvoices);
  const todayCollected = sumTotal(todayInvoices);

  // ── DYNAMIC FIXED COSTS & DEBTS FROM ACTIVE DB RECORDS ─────────────────────
  // A cost is strictly counted as active unless the user inactives/deletes it or marks it completed!
  let totalActiveStoreOpexMonthly = 0;
  let totalActiveLoansMonthly = 0;

  const activeObligations: ActiveObligationItem[] = [];
  const activeDebtsCountdowns: Array<{
    name: string;
    monthlyEmi: number;
    expiryDate?: string;
    monthsRemaining?: number;
    totalRepaymentAmount?: number;
    totalRepaidAmount?: number;
    freedomMilestone?: string;
  }> = [];

  for (const r of recurringExpenses) {
    const monthlyAmt = toMonthlyAmount(Number(r.amount) || 0, r.frequency || 'monthly');
    const weeklyAmt = Math.round((monthlyAmt * 12) / 52);

    const isDebt = Boolean(
      r.isLoanOrDebt ||
      r.category === 'qurdan' ||
      r.category === 'loan' ||
      r.name.toLowerCase().includes('loan') ||
      r.name.toLowerCase().includes('qardan') ||
      r.name.toLowerCase().includes('emi')
    );

    if (isDebt) {
      totalActiveLoansMonthly += monthlyAmt;

      // Completion / Expiry Date calculation
      let expiryDateStr: string | undefined = undefined;
      let monthsRem: number | undefined = undefined;
      let freedomMilestone: string | undefined = undefined;

      if (r.completionDate) {
        const cDate = new Date(r.completionDate);
        expiryDateStr = cDate.toISOString().slice(0, 10);
        monthsRem = Math.max(0, (cDate.getFullYear() - referenceDate.getFullYear()) * 12 + (cDate.getMonth() - referenceDate.getMonth()));
        freedomMilestone = cDate.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' });
      } else if (r.name.toLowerCase().includes('28') || monthlyAmt === 28000) {
        // Default Loan 2 April 2027 if not explicitly overridden
        const cDate = new Date('2027-04-30T23:59:59.999Z');
        expiryDateStr = '2027-04-30';
        monthsRem = Math.max(0, (cDate.getFullYear() - referenceDate.getFullYear()) * 12 + (cDate.getMonth() - referenceDate.getMonth()));
        freedomMilestone = 'May 1, 2027';
      }

      activeDebtsCountdowns.push({
        name: r.name,
        monthlyEmi: monthlyAmt,
        expiryDate: expiryDateStr,
        monthsRemaining: monthsRem,
        totalRepaymentAmount: r.totalRepaymentAmount,
        totalRepaidAmount: r.totalRepaidAmount,
        freedomMilestone,
      });
    } else {
      totalActiveStoreOpexMonthly += monthlyAmt;
    }

    activeObligations.push({
      id: String(r._id),
      name: r.name,
      category: r.category,
      monthlyAmount: monthlyAmt,
      weeklyAmount: weeklyAmt,
      isDebt,
      completionDate: r.completionDate ? new Date(r.completionDate).toISOString().slice(0, 10) : undefined,
      totalRepaymentAmount: r.totalRepaymentAmount,
      totalRepaidAmount: r.totalRepaidAmount,
      repaymentStatus: r.repaymentStatus || 'ongoing',
    });
  }

  // Fallbacks if no recurring records are seeded: Rent ₹25k, Salary ₹15k, Utilities ₹2.5k
  if (totalActiveStoreOpexMonthly === 0) {
    totalActiveStoreOpexMonthly = 42500; // Baseline Rent + Salaries + Utilities
  }

  const fixedStoreOpexWeekly = Math.round((totalActiveStoreOpexMonthly * 12) / 52);
  const loan2ReserveWeekly = Math.round((totalActiveLoansMonthly * 12) / 52);
  const vendorRepaymentWeekly = 9200;  // ₹40,000/mo
  const rollingLabSupplyWeekly = 3500;  // ₹15,000/mo

  const weeklyTarget = fixedStoreOpexWeekly + loan2ReserveWeekly + vendorRepaymentWeekly + rollingLabSupplyWeekly;
  const totalMonthlyObligation = totalActiveStoreOpexMonthly + totalActiveLoansMonthly + 40000 + 15000;
  const dailyTarget = Math.round(totalMonthlyObligation / 30);

  // Week Days Elapsed (e.g. Mon=1, Tue=2 ... Sun=7)
  const currentWeekDaysElapsed = dayOfWeek === 0 ? 7 : dayOfWeek;
  const currentWeekDailyAvg = currentWeekDaysElapsed > 0 ? Math.round(weekCollected / currentWeekDaysElapsed) : 0;
  const weeklyProgressPct = Math.min(100, Math.round((weekCollected / weeklyTarget) * 100));

  let paceStatus: 'ahead' | 'on_track' | 'behind' = 'on_track';
  const expectedPaceSoFar = currentWeekDaysElapsed * dailyTarget;
  if (weekCollected >= expectedPaceSoFar * 1.05) paceStatus = 'ahead';
  else if (weekCollected < expectedPaceSoFar * 0.85) paceStatus = 'behind';

  // Vendor Balances
  const vendorDueMap: Record<string, number> = {};
  for (const b of vendorBills) {
    const name = (b as any).vendorName || (b as any).vendor || 'Unknown';
    const due = Math.max(0, (Number((b as any).totalAmount) || 0) - (Number((b as any).paidAmount) || 0));
    vendorDueMap[name] = (vendorDueMap[name] || 0) + due;
  }

  const currentOutstanding = Object.values(vendorDueMap).reduce((s, d) => s + d, 0);
  const initialBacklog = 246475;
  const totalPaidOff = Math.max(0, initialBacklog - currentOutstanding);
  const percentCleared = Math.round((totalPaidOff / initialBacklog) * 100);

  // Prioritized 6-Month Vendor Payoff Queue
  const queueTemplate: { name: string; targetMonth: string; category: 'frames' | 'fragrance' | 'lab' | 'repairs' }[] = [
    { name: 'Aziz Bhai Mirror', targetMonth: 'Sep 2026', category: 'repairs' },
    { name: 'Winchester', targetMonth: 'Sep 2026', category: 'frames' },
    { name: 'Page 4', targetMonth: 'Sep-Oct 2026', category: 'frames' },
    { name: 'Kannauj Attar', targetMonth: 'Oct 2026', category: 'fragrance' },
    { name: 'Tusli', targetMonth: 'Oct-Dec 2026', category: 'frames' },
    { name: 'First TIme', targetMonth: 'Dec-Jan 2027', category: 'frames' },
    { name: 'Lens Wholesaler', targetMonth: 'Jan-Feb 2027', category: 'lab' },
  ];

  let priority = 1;
  let activeFound = false;
  const step2VendorQueue: VendorQueueItem[] = queueTemplate.map((item) => {
    const due = vendorDueMap[item.name] ?? 0;
    let status: 'active_target' | 'queued' | 'cleared' = 'queued';
    if (due <= 0) {
      status = 'cleared';
    } else if (!activeFound) {
      status = 'active_target';
      activeFound = true;
    }
    return {
      vendorName: item.name === 'Tusli' ? 'Tulsi Frames' : item.name === 'First TIme' ? 'First Time Frames' : item.name,
      totalDue: Math.round(due),
      priorityOrder: priority++,
      status,
      targetMonth: item.targetMonth,
      category: item.category,
    };
  });

  // Rolling averages
  const rolling7dDailyAvg = Math.round(sales7d / 7);
  const rolling30dDailyAvg = Math.round(sales30d / 30);

  // Month-to-Date Status
  const mtdDaysElapsed = referenceDate.getDate();
  const mtdTargetBreakEven = totalMonthlyObligation;
  const mtdExpectedPace = (mtdTargetBreakEven / 30) * mtdDaysElapsed;
  let mtdPaceStatus: 'profitable_surplus' | 'break_even_pace' | 'needs_attention' = 'break_even_pace';
  if (mtdSales >= mtdExpectedPace * 1.1) mtdPaceStatus = 'profitable_surplus';
  else if (mtdSales < mtdExpectedPace * 0.85) mtdPaceStatus = 'needs_attention';

  // Primary Loan Countdown (default Loan 2 or first active debt)
  const primaryLoan = activeDebtsCountdowns.find((d) => d.monthlyEmi === 28000 || d.name.toLowerCase().includes('28')) || activeDebtsCountdowns[0] || {
    monthlyEmi: 28000,
    expiryDate: '2027-04-30',
    monthsRemaining: 8,
    freedomMilestone: 'May 1, 2027',
  };

  return {
    generatedAt: referenceDate.toISOString(),
    weeklyVault: {
      dailyTarget,
      weeklyTarget,
      currentWeekCollected: Math.round(weekCollected),
      currentWeekDaysElapsed,
      currentWeekDailyAvg,
      weekStartDate: monday.toISOString(),
      weekEndDate: sunday.toISOString(),
      weeklyProgressPct,
      paceStatus,
      breakdown: {
        fixedStoreOpex: fixedStoreOpexWeekly,
        loan2Reserve: loan2ReserveWeekly,
        vendorRepayment: vendorRepaymentWeekly,
        rollingLabSupply: rollingLabSupplyWeekly,
      },
      activeObligations,
    },
    allocationAdvisor: {
      todayCollected: Math.round(todayCollected),
      step1VaultQuota: {
        amount: dailyTarget,
        label: `Step 1: Lock Fixed Vault Reserve (₹${dailyTarget.toLocaleString('en-IN')}/day)`,
        desc: `Covers ${activeObligations.length} Active Fixed Commitments (OpEx: ₹${totalActiveStoreOpexMonthly.toLocaleString('en-IN')}/mo, Active Loans: ₹${totalActiveLoansMonthly.toLocaleString('en-IN')}/mo).`,
      },
      step2VendorQueue,
      step3RollingLab: {
        weeklyAmount: 3500,
        desc: 'Pay lens wholesaler weekly as jobs are fitted so no new lens debt accumulates.',
      },
      step4OwnerBuffer: {
        safeRetainedAmount: Math.max(0, Math.round(todayCollected - dailyTarget)),
        desc: 'Safe operating buffer & owner retained cash once daily vault target is met.',
      },
    },
    onTrackAnalysis: {
      mtdSales: Math.round(mtdSales),
      mtdTargetBreakEven,
      mtdDaysElapsed,
      mtdPaceStatus,
      rolling7dDailyAvg,
      rolling30dDailyAvg,
      dailyTargetBenchmark: dailyTarget,
      vendorDebtBurnDown: {
        initialBacklog,
        currentOutstanding,
        totalPaidOff,
        percentCleared,
        monthlyTargetRepayment: 40000,
        projectedFreedomDate: 'Feb–Mar 2027',
      },
      activeDebtsCountdowns,
      loan2Countdown: {
        monthlyEmi: primaryLoan.monthlyEmi || 28000,
        expiryDate: primaryLoan.expiryDate || '2027-04-30',
        monthsRemaining: primaryLoan.monthsRemaining ?? 8,
        freedomMilestone: primaryLoan.freedomMilestone || 'May 1, 2027',
      },
    },
  };
};
