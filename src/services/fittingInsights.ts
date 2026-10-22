/**
 * Lens-fitting side business (lenses we source and fit for other opticians / doctors), for the
 * optics insights page. Revenue is what we charge the optician (lens charge + fitting); profit is our
 * lens margin (lens charge - lens cost) + fitting charge. Jobs count by job date; unpriced jobs, and
 * priced jobs whose lens cost is not entered yet (their profit reads high), are counted apart.
 */
import { DEFAULT_FITTING_BILL_THRESHOLD } from '../models/FittingParty.model';

interface InsightJob {
  _id?: unknown;
  party: unknown;
  partyName?: string;
  date: Date | string;
  lensSpec?: string;
  quantity?: number;
  lensCost?: number;
  lensCharge?: number;
  margin?: number;
  fittingCharge?: number;
  total?: number;
  status?: string;
  billed?: boolean;
}

interface InsightParty {
  _id: unknown;
  name: string;
  shopName?: string;
  billThreshold?: number;
}

interface InsightStatement {
  party: unknown;
  total?: number;
  status?: string;
  paidAt?: Date | string | null;
}

const r1 = (n: number) => Math.round(n * 10) / 10;
const pct = (a: number, b: number) => (b > 0 ? r1((a / b) * 100) : null);
const live = (j: InsightJob) => j.status !== 'cancelled';

function totals(jobs: InsightJob[]) {
  const priced = jobs.filter((j) => (j.total || 0) > 0);
  const revenue = priced.reduce((s, j) => s + (j.total || 0), 0);
  const lensCost = priced.reduce((s, j) => s + (j.lensCost || 0), 0);
  const margin = priced.reduce((s, j) => s + (j.margin || 0), 0);
  const fittingIncome = priced.reduce((s, j) => s + (j.fittingCharge || 0), 0);
  const profit = margin + fittingIncome;
  return {
    jobs: jobs.length,
    pairs: jobs.reduce((s, j) => s + (j.quantity || 1), 0),
    unpricedJobs: jobs.length - priced.length,
    noCostJobs: priced.filter((j) => (j.lensCharge || 0) > 0 && !(j.lensCost || 0)).length,
    revenue,
    lensCost,
    margin,
    fittingIncome,
    profit,
    profitPct: pct(profit, revenue),
    avgProfitPerJob: priced.length ? Math.round(profit / priced.length) : null,
  };
}

export function buildFittingInsights(input: {
  jobs: InsightJob[];
  previousJobs: InsightJob[];
  openJobs: InsightJob[];
  parties: InsightParty[];
  statements: InsightStatement[];
  from: Date;
  now: Date;
}) {
  const jobs = input.jobs.filter(live);
  const open = input.openJobs.filter((j) => live(j) && !j.billed);
  const current = totals(jobs);
  const previous = totals(input.previousJobs.filter(live));
  const inWindow = (d?: Date | string | null) => !!d && new Date(d) >= input.from && new Date(d) <= input.now;

  const unpaid = input.statements.filter((s) => s.status === 'unpaid');
  const collected = input.statements
    .filter((s) => s.status === 'paid' && inWindow(s.paidAt))
    .reduce((s, st) => s + (st.total || 0), 0);

  const byParty = input.parties
    .map((p) => {
      const pid = String(p._id);
      const mine = jobs.filter((j) => String(j.party) === pid);
      const t = totals(mine);
      const openTotal = open.filter((j) => String(j.party) === pid).reduce((s, j) => s + (j.total || 0), 0);
      const unpaidTotal = unpaid.filter((s) => String(s.party) === pid).reduce((s, st) => s + (st.total || 0), 0);
      const threshold = p.billThreshold || DEFAULT_FITTING_BILL_THRESHOLD;
      const last = mine.reduce<Date | null>((d, j) => (!d || new Date(j.date) > d ? new Date(j.date) : d), null);
      return {
        party: pid,
        name: p.shopName ? `${p.name} (${p.shopName})` : p.name,
        jobs: t.jobs,
        revenue: t.revenue,
        profit: t.profit,
        profitPct: t.profitPct,
        openTotal,
        unpaidTotal,
        billDue: openTotal >= threshold,
        lastJobAt: last ? last.toISOString() : null,
      };
    })
    .filter((r) => r.jobs > 0 || r.openTotal > 0 || r.unpaidTotal > 0)
    .sort((a, b) => b.revenue - a.revenue || b.openTotal - a.openTotal);

  const lensMap = new Map<string, InsightJob[]>();
  for (const j of jobs) {
    const key = (j.lensSpec || 'Unspecified').trim();
    lensMap.set(key, [...(lensMap.get(key) ?? []), j]);
  }
  const byLens = [...lensMap.entries()]
    .map(([spec, list]) => {
      const t = totals(list);
      return { spec, jobs: t.jobs, revenue: t.revenue, profit: t.profit, avgProfitPerJob: t.avgProfitPerJob };
    })
    .sort((a, b) => b.jobs - a.jobs || b.profit - a.profit)
    .slice(0, 8);

  return {
    ...current,
    previous: { jobs: previous.jobs, revenue: previous.revenue, profit: previous.profit },
    openTotal: open.reduce((s, j) => s + (j.total || 0), 0),
    unpaidTotal: unpaid.reduce((s, st) => s + (st.total || 0), 0),
    unpaidStatements: unpaid.length,
    collected,
    billsDue: byParty.filter((p) => p.billDue).length,
    byParty,
    byLens,
  };
}

export type FittingInsights = ReturnType<typeof buildFittingInsights>;
