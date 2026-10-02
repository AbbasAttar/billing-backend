import { Invoice } from '../models/Invoice.model';
import { VendorBill } from '../models/VendorBill.model';
import { RecurringExpense } from '../models/RecurringExpense.model';

export interface WeeklyHistoryItem {
  weekLabel: string;
  weekStartDate: string;
  weekEndDate: string;
  target: number;
  collected: number;
  progressPct: number;
  status: 'overachieved' | 'achieved' | 'shortfall';
  surplusDeficit: number;
  isCurrentWeek?: boolean;
}

export interface PreviousWeekPerformance {
  weekStartDate: string;
  weekEndDate: string;
  weekLabel: string;
  target: number;
  collected: number;
  progressPct: number;
  status: 'overachieved' | 'achieved' | 'shortfall';
  surplusDeficit: number;
  samePointIntake: number;
  likeForLikeDelta: number;
  likeForLikePct: number;
  likeForLikePacingStatus: 'ahead' | 'behind' | 'matched';
  allocationNote: string;
}

export interface VendorQueueItem {
  vendorName: string;
  totalDue: number;
  priorityOrder: number;
  status: 'active_target' | 'queued' | 'cleared';
  targetMonth: string;
  category: 'frames' | 'fragrance' | 'lab' | 'repairs';
  suggestedPayout?: number;
  isFullPayoff?: boolean;
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
    previousWeek: PreviousWeekPerformance;
    weeklyHistory: WeeklyHistoryItem[];
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
    dailyTarget: number;
    feasibility: {
      isTargetMetToday: boolean;
      intakeDeficit: number;
      intakeSurplus: number;
      guidanceMode: 'preserve_cash' | 'surplus_distribution';
      guidance: string;
      actionHeadline: string;
    };
    step1VaultQuota: {
      amount: number;
      label: string;
      desc: string;
      collectedToday: number;
      status: 'funded' | 'partially_funded' | 'unfunded';
    };
    step2VendorQueue: VendorQueueItem[];
    activeVendorTarget: {
      vendorName: string;
      totalDue: number;
      suggestedPayout: number;
      isFullPayoff: boolean;
      category: string;
      targetMonth?: string;
      actionStatus: 'ready' | 'defer';
      actionNote: string;
    } | null;
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

const formatDateRange = (d1: Date, d2: Date): string => {
  const m1 = d1.toLocaleDateString('en-IN', { month: 'short', day: 'numeric' });
  const m2 = d2.toLocaleDateString('en-IN', { month: 'short', day: 'numeric' });
  return `${m1} – ${m2}`;
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

  // Week Days Elapsed (Mon=1, Tue=2, ... Sun=7)
  const currentWeekDaysElapsed = dayOfWeek === 0 ? 7 : dayOfWeek;

  // Previous Week (Monday to Sunday)
  const prevMonday = new Date(monday);
  prevMonday.setDate(monday.getDate() - 7);
  prevMonday.setHours(0, 0, 0, 0);

  const prevSunday = new Date(prevMonday);
  prevSunday.setDate(prevMonday.getDate() + 6);
  prevSunday.setHours(23, 59, 59, 999);

  // Previous week like-for-like end date (same number of elapsed days)
  const prevSameDayEnd = new Date(prevMonday);
  prevSameDayEnd.setDate(prevMonday.getDate() + (currentWeekDaysElapsed - 1));
  prevSameDayEnd.setHours(23, 59, 59, 999);

  // 4 Weeks Ago Start (covers past 4 complete/active weeks for trend)
  const fourWeeksAgoStart = new Date(monday);
  fourWeeksAgoStart.setDate(monday.getDate() - 28);
  fourWeeksAgoStart.setHours(0, 0, 0, 0);

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
    fourWeeksInvoices,
    mtdInvoices,
    last7dInvoices,
    last30dInvoices,
    todayInvoices,
    vendorBills,
    recurringExpenses,
  ] = await Promise.all([
    Invoice.find({ billDate: { $gte: fourWeeksAgoStart, $lte: sunday } }).lean(),
    Invoice.find({ billDate: { $gte: monthStart, $lte: referenceDate } }).lean(),
    Invoice.find({ billDate: { $gte: sevenDaysAgo, $lte: referenceDate } }).lean(),
    Invoice.find({ billDate: { $gte: thirtyDaysAgo, $lte: referenceDate } }).lean(),
    Invoice.find({ billDate: { $gte: todayStart, $lte: todayEnd } }).lean(),
    VendorBill.find().lean(),
    RecurringExpense.find({ isActive: true }).lean(),
  ]);

  const sumTotal = (invs: any[]) =>
    invs.reduce((sum, inv) => sum + (Number(inv.total) || 0), 0);

  // Split fourWeeksInvoices into current, previous, and like-for-like subsets
  const currentWeekInvoices = fourWeeksInvoices.filter((inv: any) => {
    const d = new Date(inv.billDate);
    return d >= monday && d <= sunday;
  });

  const prevWeekInvoices = fourWeeksInvoices.filter((inv: any) => {
    const d = new Date(inv.billDate);
    return d >= prevMonday && d <= prevSunday;
  });

  const prevWeekSameDayInvoices = fourWeeksInvoices.filter((inv: any) => {
    const d = new Date(inv.billDate);
    return d >= prevMonday && d <= prevSameDayEnd;
  });

  const weekCollected = sumTotal(currentWeekInvoices);
  const prevWeekCollected = sumTotal(prevWeekInvoices);
  const prevWeekSameDayCollected = sumTotal(prevWeekSameDayInvoices);

  const mtdSales = sumTotal(mtdInvoices);
  const sales7d = sumTotal(last7dInvoices);
  const sales30d = sumTotal(last30dInvoices);
  const todayCollected = sumTotal(todayInvoices);

  // ── DYNAMIC FIXED COSTS & DEBTS FROM ACTIVE DB RECORDS ─────────────────────
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
    totalActiveStoreOpexMonthly = 42500;
  }

  const fixedStoreOpexWeekly = Math.round((totalActiveStoreOpexMonthly * 12) / 52);
  const loan2ReserveWeekly = Math.round((totalActiveLoansMonthly * 12) / 52);
  const vendorRepaymentWeekly = 9200;  // ₹40,000/mo
  const rollingLabSupplyWeekly = 3500;  // ₹15,000/mo

  const weeklyTarget = fixedStoreOpexWeekly + loan2ReserveWeekly + vendorRepaymentWeekly + rollingLabSupplyWeekly;
  const totalMonthlyObligation = totalActiveStoreOpexMonthly + totalActiveLoansMonthly + 40000 + 15000;
  const dailyTarget = Math.round(totalMonthlyObligation / 30);

  const currentWeekDailyAvg = currentWeekDaysElapsed > 0 ? Math.round(weekCollected / currentWeekDaysElapsed) : 0;
  const weeklyProgressPct = Math.min(100, Math.round((weekCollected / weeklyTarget) * 100));

  let paceStatus: 'ahead' | 'on_track' | 'behind' = 'on_track';
  const expectedPaceSoFar = currentWeekDaysElapsed * dailyTarget;
  if (weekCollected >= expectedPaceSoFar * 1.05) paceStatus = 'ahead';
  else if (weekCollected < expectedPaceSoFar * 0.85) paceStatus = 'behind';

  // ── WEEK-ON-WEEK (WoW) PROGRESS & PREVIOUS WEEK ANALYSIS ─────────────────
  const prevWeekProgressPct = Math.round((prevWeekCollected / weeklyTarget) * 100);
  const prevWeekSurplusDeficit = Math.round(prevWeekCollected - weeklyTarget);

  let prevWeekStatus: 'overachieved' | 'achieved' | 'shortfall' = 'achieved';
  if (prevWeekCollected >= weeklyTarget * 1.03) {
    prevWeekStatus = 'overachieved';
  } else if (prevWeekCollected < weeklyTarget * 0.95) {
    prevWeekStatus = 'shortfall';
  }

  const likeForLikeDelta = Math.round(weekCollected - prevWeekSameDayCollected);
  const likeForLikePct = prevWeekSameDayCollected > 0
    ? Math.round(((weekCollected - prevWeekSameDayCollected) / prevWeekSameDayCollected) * 100)
    : 0;

  const likeForLikePacingStatus: 'ahead' | 'behind' | 'matched' =
    likeForLikeDelta > 500 ? 'ahead' : likeForLikeDelta < -500 ? 'behind' : 'matched';

  const previousWeekPerformance: PreviousWeekPerformance = {
    weekStartDate: prevMonday.toISOString(),
    weekEndDate: prevSunday.toISOString(),
    weekLabel: formatDateRange(prevMonday, prevSunday),
    target: weeklyTarget,
    collected: Math.round(prevWeekCollected),
    progressPct: prevWeekProgressPct,
    status: prevWeekStatus,
    surplusDeficit: prevWeekSurplusDeficit,
    samePointIntake: Math.round(prevWeekSameDayCollected),
    likeForLikeDelta,
    likeForLikePct,
    likeForLikePacingStatus,
    allocationNote: prevWeekSurplusDeficit >= 0
      ? `Overachieved by ₹${prevWeekSurplusDeficit.toLocaleString('en-IN')} (+${prevWeekProgressPct - 100}%). Surplus safely absorbed into working capital & vendor debt liquidation.`
      : `Closed with ₹${Math.abs(prevWeekSurplusDeficit).toLocaleString('en-IN')} shortfall against quota. Pace target adjusted to recover backlog.`,
  };

  // 4-Week History Trend Array (Weeks -3, -2, -1, 0)
  const weeklyHistory: WeeklyHistoryItem[] = [];
  for (let i = 3; i >= 0; i--) {
    const wStart = new Date(monday);
    wStart.setDate(monday.getDate() - i * 7);
    const wEnd = new Date(wStart);
    wEnd.setDate(wStart.getDate() + 6);
    wEnd.setHours(23, 59, 59, 999);

    const wInvs = fourWeeksInvoices.filter((inv: any) => {
      const d = new Date(inv.billDate);
      return d >= wStart && d <= wEnd;
    });
    const col = sumTotal(wInvs);
    const pct = Math.round((col / weeklyTarget) * 100);
    const diff = Math.round(col - weeklyTarget);

    let stat: 'overachieved' | 'achieved' | 'shortfall' = 'achieved';
    if (col >= weeklyTarget * 1.03) stat = 'overachieved';
    else if (col < weeklyTarget * 0.95) stat = 'shortfall';

    weeklyHistory.push({
      weekLabel: formatDateRange(wStart, wEnd),
      weekStartDate: wStart.toISOString(),
      weekEndDate: wEnd.toISOString(),
      target: weeklyTarget,
      collected: Math.round(col),
      progressPct: pct,
      status: stat,
      surplusDeficit: diff,
      isCurrentWeek: i === 0,
    });
  }

  // ── REAL DYNAMIC VENDOR BALANCES & PRIORITIZATION ────────────────────────
  const vendorDueMap: Record<string, { totalDue: number; category: 'frames' | 'fragrance' | 'lab' | 'repairs'; overdueCount: number }> = {};
  for (const b of vendorBills) {
    const rawName = (b as any).vendorName || (b as any).vendor || 'Unknown';
    const name = rawName.trim();
    const due = Math.max(0, (Number((b as any).totalAmount) || 0) - (Number((b as any).paidAmount) || 0));
    const cat = ((b as any).category || 'frames') as 'frames' | 'fragrance' | 'lab' | 'repairs';
    const isOverdue = (b as any).dueDate && new Date((b as any).dueDate) < referenceDate && due > 0;

    if (!vendorDueMap[name]) {
      vendorDueMap[name] = { totalDue: 0, category: cat, overdueCount: 0 };
    }
    vendorDueMap[name].totalDue += due;
    if (isOverdue) vendorDueMap[name].overdueCount += 1;
  }

  const currentOutstanding = Object.values(vendorDueMap).reduce((s, v) => s + v.totalDue, 0);
  const initialBacklog = 246475;
  const totalPaidOff = Math.max(0, initialBacklog - currentOutstanding);
  const percentCleared = Math.round((totalPaidOff / initialBacklog) * 100);

  // Seed / Known prioritized vendors list
  const knownTemplates: { name: string; targetMonth: string; category: 'frames' | 'fragrance' | 'lab' | 'repairs' }[] = [
    { name: 'Aziz Bhai Mirror', targetMonth: 'Current Target', category: 'repairs' },
    { name: 'Winchester', targetMonth: 'Next in Queue', category: 'frames' },
    { name: 'Page 4', targetMonth: 'Upcoming', category: 'frames' },
    { name: 'Kannauj Attar', targetMonth: 'Upcoming', category: 'fragrance' },
    { name: 'Tulsi Frames', targetMonth: 'Upcoming', category: 'frames' },
    { name: 'First Time Frames', targetMonth: 'Upcoming', category: 'frames' },
    { name: 'Lens Wholesaler', targetMonth: 'Weekly Rolling', category: 'lab' },
  ];

  // Map known vendors first, then append any additional dynamic vendors from DB
  const processedVendors = new Set<string>();
  const combinedQueue: Array<{
    vendorName: string;
    totalDue: number;
    category: 'frames' | 'fragrance' | 'lab' | 'repairs';
    targetMonth: string;
    overdueCount: number;
  }> = [];

  for (const t of knownTemplates) {
    const vData = vendorDueMap[t.name] || vendorDueMap[t.name === 'Tulsi Frames' ? 'Tusli' : t.name === 'First Time Frames' ? 'First TIme' : t.name];
    const due = vData ? vData.totalDue : 0;
    combinedQueue.push({
      vendorName: t.name,
      totalDue: due,
      category: t.category,
      targetMonth: t.targetMonth,
      overdueCount: vData?.overdueCount || 0,
    });
    processedVendors.add(t.name);
    if (t.name === 'Tulsi Frames') processedVendors.add('Tusli');
    if (t.name === 'First Time Frames') processedVendors.add('First TIme');
  }

  // Add any extra vendors with dues in DB that were not in known templates
  for (const [vName, vData] of Object.entries(vendorDueMap)) {
    if (!processedVendors.has(vName) && vData.totalDue > 0) {
      combinedQueue.push({
        vendorName: vName,
        totalDue: vData.totalDue,
        category: vData.category,
        targetMonth: vData.overdueCount > 0 ? 'Urgent / Overdue' : 'Active Account',
        overdueCount: vData.overdueCount,
      });
      processedVendors.add(vName);
    }
  }

  let priority = 1;
  let activeFound = false;
  let activeTargetVendor: {
    vendorName: string;
    totalDue: number;
    suggestedPayout: number;
    isFullPayoff: boolean;
    category: string;
    targetMonth?: string;
    actionStatus: 'ready' | 'defer';
    actionNote: string;
  } | null = null;

  const step2VendorQueue: VendorQueueItem[] = combinedQueue.map((item) => {
    let status: 'active_target' | 'queued' | 'cleared' = 'queued';
    const due = Math.round(item.totalDue);

    if (due <= 0) {
      status = 'cleared';
    } else if (!activeFound) {
      status = 'active_target';
      activeFound = true;

      // Realistic, capped recommendation: NEVER recommend more than the actual balance!
      // If balance is ₹5,500, suggest ₹5,500 full settlement, NOT ₹10,000!
      const suggestedPayout = Math.min(due, 10000);
      const isFullPayoff = suggestedPayout >= due;

      const isTargetMetToday = todayCollected >= dailyTarget;
      const actionStatus = isTargetMetToday ? 'ready' : 'defer';
      const actionNote = isTargetMetToday
        ? `Daily quota secured. Transfer ₹${suggestedPayout.toLocaleString('en-IN')} to ${item.vendorName} to ${isFullPayoff ? 'completely liquidate this account to ₹0' : 'reduce balance to ₹' + (due - suggestedPayout).toLocaleString('en-IN')}.`
        : `Today's collections (₹${todayCollected.toLocaleString('en-IN')}) are below the ₹${dailyTarget.toLocaleString('en-IN')} daily vault quota. Preserve cash float; queue transfer for Monday settlement.`;

      activeTargetVendor = {
        vendorName: item.vendorName,
        totalDue: due,
        suggestedPayout,
        isFullPayoff,
        category: item.category,
        targetMonth: item.targetMonth,
        actionStatus,
        actionNote,
      };
    }

    const suggestedPayout = due > 0 ? Math.min(due, 10000) : 0;
    const isFullPayoff = due > 0 && suggestedPayout >= due;

    return {
      vendorName: item.vendorName,
      totalDue: due,
      priorityOrder: priority++,
      status,
      targetMonth: item.targetMonth,
      category: item.category,
      suggestedPayout,
      isFullPayoff,
    };
  });

  // ── REALISTIC CASH ALLOCATION FEASIBILITY ─────────────────────────────────
  const isTargetMetToday = todayCollected >= dailyTarget;
  const intakeDeficit = Math.max(0, dailyTarget - todayCollected);
  const intakeSurplus = Math.max(0, todayCollected - dailyTarget);

  const guidanceMode: 'preserve_cash' | 'surplus_distribution' = isTargetMetToday ? 'surplus_distribution' : 'preserve_cash';
  const actionHeadline = isTargetMetToday
    ? `Vault Quota Secured · ₹${intakeSurplus.toLocaleString('en-IN')} Surplus Unlocked`
    : `Preserve Counter Float · ₹${intakeDeficit.toLocaleString('en-IN')} Needed for Daily Quota`;

  const guidance = isTargetMetToday
    ? `Today's counter collection (₹${todayCollected.toLocaleString('en-IN')}) has satisfied the ₹${dailyTarget.toLocaleString('en-IN')} daily fixed quota. The ₹${intakeSurplus.toLocaleString('en-IN')} surplus is safe for vendor payments and owner buffer.`
    : `Today's intake (₹${todayCollected.toLocaleString('en-IN')}) is currently below the ₹${dailyTarget.toLocaleString('en-IN')} target. Do not initiate voluntary vendor payouts from counter till today; preserve physical cash for change and customer lens fitting deliveries.`;

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
      previousWeek: previousWeekPerformance,
      weeklyHistory,
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
      dailyTarget,
      feasibility: {
        isTargetMetToday,
        intakeDeficit,
        intakeSurplus,
        guidanceMode,
        guidance,
        actionHeadline,
      },
      step1VaultQuota: {
        amount: dailyTarget,
        collectedToday: Math.round(todayCollected),
        status: isTargetMetToday ? 'funded' : todayCollected > 0 ? 'partially_funded' : 'unfunded',
        label: `Step 1: Lock Fixed Vault Reserve (₹${dailyTarget.toLocaleString('en-IN')}/day)`,
        desc: `Covers ${activeObligations.length} Active Fixed Commitments (OpEx: ₹${totalActiveStoreOpexMonthly.toLocaleString('en-IN')}/mo, Active Loans: ₹${totalActiveLoansMonthly.toLocaleString('en-IN')}/mo).`,
      },
      step2VendorQueue,
      activeVendorTarget: activeTargetVendor,
      step3RollingLab: {
        weeklyAmount: 3500,
        desc: 'Pay lens wholesaler weekly as Rx jobs are delivered to prevent supplier hold and lens backlogs.',
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
