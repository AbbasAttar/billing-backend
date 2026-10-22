import { Request, Response, NextFunction } from 'express';
import { FittingParty, DEFAULT_FITTING_BILL_THRESHOLD } from '../models/FittingParty.model';
import { FittingJob, FITTING_JOB_STATUSES, FITTING_FRAME_TYPES, fittingJobAmounts } from '../models/FittingJob.model';
import { FittingStatement, FittingStatementLine } from '../models/FittingStatement.model';
import { InvoiceItem } from '../models/InvoiceItem.model';
import { buildDirectLabItem } from './wholesalerQueue.controller';

const money = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : 0;
};
const idOf = (d: any) => String(d?._id ?? d?.id ?? d);

// ── Parties (opticians / doctors) ─────────────────────────────────────────────

// GET /api/fitting/parties — each party with its running (unbilled) account and unpaid statements
export const getParties = async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const [parties, openJobs, unpaid] = await Promise.all([
      FittingParty.find({}).lean(),
      FittingJob.find({ billed: false }).lean(),
      FittingStatement.find({ status: 'unpaid' }).lean(),
    ]);

    const rows = parties.map((p: any) => {
      const pid = idOf(p);
      const jobs = openJobs.filter((j: any) => String(j.party) === pid && j.status !== 'cancelled');
      const statements = unpaid.filter((s: any) => String(s.party) === pid);
      return {
        ...p,
        billThreshold: p.billThreshold || DEFAULT_FITTING_BILL_THRESHOLD,
        openJobs: jobs.length,
        openTotal: jobs.reduce((s: number, j: any) => s + (j.total || 0), 0),
        pricingPending: jobs.filter((j: any) => !j.total).length,
        unpaidStatements: statements.length,
        unpaidTotal: statements.reduce((s: number, st: any) => s + (st.total || 0), 0),
        lastJobAt: jobs.reduce((d: any, j: any) => (!d || new Date(j.date) > new Date(d) ? j.date : d), null),
      };
    });
    rows.sort((a: any, b: any) => b.openTotal - a.openTotal || a.name.localeCompare(b.name));
    res.json({ parties: rows });
  } catch (error) {
    next(error);
  }
};

// POST /api/fitting/parties
export const createParty = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { name, shopName, phone, city, notes, billThreshold } = req.body ?? {};
    if (!name || !String(name).trim()) {
      res.status(400).json({ message: 'Name is required.' });
      return;
    }
    const party = await FittingParty.create({
      name: String(name).trim(),
      shopName: shopName?.trim() || undefined,
      phone: phone?.trim() || undefined,
      city: city?.trim() || undefined,
      notes: notes?.trim() || undefined,
      billThreshold: money(billThreshold) || DEFAULT_FITTING_BILL_THRESHOLD,
    });
    res.status(201).json(party);
  } catch (error) {
    next(error);
  }
};

// PATCH /api/fitting/parties/:id
export const updateParty = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const update: Record<string, any> = {};
    for (const k of ['name', 'shopName', 'phone', 'city', 'notes'] as const) {
      if (req.body?.[k] !== undefined) update[k] = String(req.body[k]).trim();
    }
    if (req.body?.billThreshold !== undefined) update.billThreshold = money(req.body.billThreshold) || DEFAULT_FITTING_BILL_THRESHOLD;
    const party = await FittingParty.findByIdAndUpdate(req.params.id, { $set: update }, { new: true });
    if (!party) {
      res.status(404).json({ message: 'Party not found.' });
      return;
    }
    if (update.name) await FittingJob.updateMany({ party: req.params.id, billed: false }, { $set: { partyName: update.name } });
    res.json(party);
  } catch (error) {
    next(error);
  }
};

// ── Jobs ──────────────────────────────────────────────────────────────────────

// GET /api/fitting/jobs?party=&billed=false|true — with the lab-queue status of each lens
export const getJobs = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const filter: Record<string, any> = {};
    if (req.query.party) filter.party = String(req.query.party);
    if (req.query.billed === 'true') filter.billed = true;
    if (req.query.billed === 'false') filter.billed = false;

    const jobs = await FittingJob.find(filter).sort({ date: -1 }).lean();
    const labIds = jobs.map((j: any) => j.labItem).filter(Boolean).map(String);
    const labItems = labIds.length ? await InvoiceItem.find({ _id: { $in: labIds } }).lean() : [];
    const labStatus = new Map(labItems.map((it: any) => [idOf(it), it.labStatus || 'pending']));

    res.json({
      jobs: jobs.map((j: any) => ({ ...j, labStatus: j.labItem ? labStatus.get(String(j.labItem)) ?? null : null })),
    });
  } catch (error) {
    next(error);
  }
};

// POST /api/fitting/jobs — log a fitting job; with `labOrder`, also puts the lens in the wholesaler queue
export const createJob = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const b = req.body ?? {};
    const party: any = b.party ? await FittingParty.findById(String(b.party)).lean() : null;
    if (!party) {
      res.status(400).json({ message: 'Pick the optician / doctor for this job.' });
      return;
    }
    if (!b.lensSpec || !String(b.lensSpec).trim()) {
      res.status(400).json({ message: 'Lens details are required.' });
      return;
    }

    const patientName = b.patientName?.trim() || undefined;
    const eye = b.eye === 'right' || b.eye === 'left' ? b.eye : 'both';
    const date = b.date ? new Date(b.date) : new Date();
    if (Number.isNaN(date.getTime())) {
      res.status(400).json({ message: 'Invalid job date.' });
      return;
    }
    let labItem: string | null = null;
    if (b.labOrder) {
      const item = buildDirectLabItem({
        ...b.labOrder,
        customerName: patientName ? `${party.name} · ${patientName}` : party.name,
        customerPhone: party.phone,
        notes: ['Fitting job', b.labOrder.notes].filter(Boolean).join(' · '),
      });
      await item.save();
      labItem = idOf(item);
    }

    const job = await FittingJob.create({
      party: idOf(party),
      partyName: party.name,
      date,
      patientName,
      frameNote: b.frameNote?.trim() || undefined,
      frameType: FITTING_FRAME_TYPES.includes(b.frameType) ? b.frameType : 'full',
      lensSpec: String(b.lensSpec).trim(),
      eye,
      reRx: eye !== 'left' ? b.reRx || undefined : undefined,
      leRx: eye !== 'right' ? b.leRx || undefined : undefined,
      quantity: Number(b.quantity) > 0 ? Number(b.quantity) : 1,
      ...fittingJobAmounts({ lensCost: money(b.lensCost), lensCharge: money(b.lensCharge), fittingCharge: money(b.fittingCharge) }),
      // Past entries copied from the books come in already delivered.
      status: FITTING_JOB_STATUSES.includes(b.status) ? b.status : 'ordered',
      labItem,
      billed: false,
      statement: null,
      notes: b.notes?.trim() || undefined,
    });
    res.status(201).json(job);
  } catch (error) {
    next(error);
  }
};

// PATCH /api/fitting/jobs/:id — charges, status, notes. Charges are locked once the job is on a statement.
export const updateJob = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const job: any = await FittingJob.findById(req.params.id).lean();
    if (!job) {
      res.status(404).json({ message: 'Job not found.' });
      return;
    }
    const b = req.body ?? {};
    const update: Record<string, any> = {};
    const chargeKeys = ['lensCost', 'lensCharge', 'fittingCharge'] as const;
    if (chargeKeys.some((k) => b[k] !== undefined)) {
      if (job.billed) {
        res.status(409).json({ message: 'This job is already on a statement; remove the statement to change charges.' });
        return;
      }
      const next: Record<string, number> = {};
      for (const k of chargeKeys) next[k] = b[k] !== undefined ? money(b[k]) : job[k] || 0;
      Object.assign(update, fittingJobAmounts(next));
    }
    if (b.status !== undefined) {
      if (!FITTING_JOB_STATUSES.includes(b.status)) {
        res.status(400).json({ message: 'Unknown status.' });
        return;
      }
      if (b.status === 'cancelled' && job.billed) {
        res.status(409).json({ message: 'A billed job cannot be cancelled.' });
        return;
      }
      update.status = b.status;
    }
    if (b.frameType !== undefined) {
      if (!FITTING_FRAME_TYPES.includes(b.frameType)) {
        res.status(400).json({ message: 'Unknown frame type.' });
        return;
      }
      update.frameType = b.frameType;
    }
    for (const k of ['patientName', 'frameNote', 'notes'] as const) {
      if (b[k] !== undefined) update[k] = String(b[k]).trim();
    }
    const saved = await FittingJob.findByIdAndUpdate(req.params.id, { $set: update }, { new: true });
    res.json(saved);
  } catch (error) {
    next(error);
  }
};

// DELETE /api/fitting/jobs/:id — only while unbilled
export const deleteJob = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const job: any = await FittingJob.findById(req.params.id).lean();
    if (!job) {
      res.status(404).json({ message: 'Job not found.' });
      return;
    }
    if (job.billed) {
      res.status(409).json({ message: 'This job is on a statement; remove the statement first.' });
      return;
    }
    await FittingJob.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
};

// ── Statements ────────────────────────────────────────────────────────────────

// POST /api/fitting/statements { party, jobIds? } — bills the given (or all open, priced) jobs
export const createStatement = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { party: partyId, jobIds } = req.body ?? {};
    const party: any = partyId ? await FittingParty.findById(String(partyId)).lean() : null;
    if (!party) {
      res.status(404).json({ message: 'Party not found.' });
      return;
    }
    const open = await FittingJob.find({ party: idOf(party), billed: false }).lean();
    const wanted = Array.isArray(jobIds) && jobIds.length ? new Set(jobIds.map(String)) : null;
    const jobs = open
      .filter((j: any) => j.status !== 'cancelled' && (j.total || 0) > 0)
      .filter((j: any) => !wanted || wanted.has(idOf(j)))
      .sort((a: any, b: any) => new Date(a.date).getTime() - new Date(b.date).getTime());
    if (!jobs.length) {
      res.status(400).json({ message: 'No priced, unbilled jobs to put on a statement.' });
      return;
    }

    const all = await FittingStatement.find({}).select('seq').lean();
    const seq = all.reduce((m: number, s: any) => Math.max(m, s.seq || 0), 0) + 1;
    const lines: FittingStatementLine[] = jobs.map((j: any) => ({
      job: idOf(j),
      date: j.date,
      patientName: j.patientName,
      lensSpec: j.lensSpec,
      eye: j.eye || 'both',
      frameType: j.frameType ?? 'full',
      reRx: j.reRx,
      leRx: j.leRx,
      quantity: j.quantity || 1,
      lensAmount: j.lensCharge || 0,
      fittingCharge: j.fittingCharge || 0,
      total: j.total || 0,
    }));

    const statement = await FittingStatement.create({
      number: `FIT-${String(seq).padStart(4, '0')}`,
      seq,
      party: idOf(party),
      partyName: party.shopName ? `${party.name} (${party.shopName})` : party.name,
      partyPhone: party.phone,
      issuedAt: new Date(),
      lines,
      total: lines.reduce((s, l) => s + l.total, 0),
      status: 'unpaid',
      paidAt: null,
      sentAt: null,
    });
    const sid = idOf(statement);
    await FittingJob.updateMany({ _id: { $in: jobs.map(idOf) } }, { $set: { billed: true, statement: sid } });
    res.status(201).json(statement);
  } catch (error) {
    next(error);
  }
};

// GET /api/fitting/statements?party=
export const getStatements = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const filter: Record<string, any> = {};
    if (req.query.party) filter.party = String(req.query.party);
    const statements = await FittingStatement.find(filter).sort({ issuedAt: -1 }).lean();
    res.json({ statements });
  } catch (error) {
    next(error);
  }
};

// GET /api/fitting/statements/:id
export const getStatement = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const statement: any = await FittingStatement.findById(req.params.id).lean();
    if (!statement) {
      res.status(404).json({ message: 'Statement not found.' });
      return;
    }
    const party = await FittingParty.findById(String(statement.party)).lean();
    res.json({ ...statement, partyDetails: party });
  } catch (error) {
    next(error);
  }
};

// PATCH /api/fitting/statements/:id { status: 'paid'|'unpaid', paymentMethod?, paymentNote?, paidAt?, sent? }
export const updateStatement = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const b = req.body ?? {};
    const update: Record<string, any> = {};
    if (b.sent) update.sentAt = new Date();
    if (b.status === 'paid') {
      update.status = 'paid';
      update.paidAt = b.paidAt ? new Date(b.paidAt) : new Date();
      update.paymentMethod = b.paymentMethod || 'cash';
      update.paymentNote = b.paymentNote?.trim() || undefined;
    } else if (b.status === 'unpaid') {
      update.status = 'unpaid';
      update.paidAt = null;
    }
    const saved = await FittingStatement.findByIdAndUpdate(req.params.id, { $set: update }, { new: true });
    if (!saved) {
      res.status(404).json({ message: 'Statement not found.' });
      return;
    }
    res.json(saved);
  } catch (error) {
    next(error);
  }
};

// DELETE /api/fitting/statements/:id — voids an unpaid statement; its jobs go back on the open account
export const deleteStatement = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const statement: any = await FittingStatement.findById(req.params.id).lean();
    if (!statement) {
      res.status(404).json({ message: 'Statement not found.' });
      return;
    }
    if (statement.status === 'paid') {
      res.status(409).json({ message: 'A paid statement cannot be removed; mark it unpaid first.' });
      return;
    }
    await FittingJob.updateMany({ statement: req.params.id }, { $set: { billed: false, statement: null } });
    await FittingStatement.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
};
