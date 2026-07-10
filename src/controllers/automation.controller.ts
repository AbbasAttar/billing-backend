import { Request, Response, NextFunction } from 'express';
import { AutomationRule, AUTOMATION_ACTIONS } from '../models/AutomationRule.model';
import { AutomationLog } from '../models/AutomationLog.model';
import { SEGMENT_KEYS } from '../models/Campaign.model';
import { runAutomationRule } from '../services/automationEngine';
import { triggerManualRun } from '../services/cron';

// ── GET /api/automation/rules ─────────────────────────────────────────────────
export const listRules = async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const rules = await AutomationRule.find().sort({ createdAt: -1 }).lean();
    res.json(rules);
  } catch (err) {
    next(err);
  }
};

// ── POST /api/automation/rules ────────────────────────────────────────────────
export const createRule = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { name, triggerSegment, action, messageTemplate, cooldownDays, batchLimit } = req.body;

    if (!name?.trim()) {
      res.status(400).json({ message: 'name is required' });
      return;
    }
    if (!SEGMENT_KEYS.includes(triggerSegment)) {
      res.status(400).json({ message: `triggerSegment must be one of: ${SEGMENT_KEYS.join(', ')}` });
      return;
    }
    if (!AUTOMATION_ACTIONS.includes(action)) {
      res.status(400).json({ message: `action must be one of: ${AUTOMATION_ACTIONS.join(', ')}` });
      return;
    }
    if (!messageTemplate?.trim()) {
      res.status(400).json({ message: 'messageTemplate is required' });
      return;
    }

    const rule = await AutomationRule.create({
      name: name.trim(),
      triggerSegment,
      action,
      messageTemplate: messageTemplate.trim(),
      cooldownDays: cooldownDays ?? 30,
      batchLimit: batchLimit ?? 0,
      isActive: false,
    });

    res.status(201).json(rule);
  } catch (err) {
    next(err);
  }
};

// ── GET /api/automation/rules/:id ─────────────────────────────────────────────
export const getRule = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const rule = await AutomationRule.findById(req.params.id).lean();
    if (!rule) { res.status(404).json({ message: 'Rule not found' }); return; }
    res.json(rule);
  } catch (err) {
    next(err);
  }
};

// ── PATCH /api/automation/rules/:id ──────────────────────────────────────────
export const updateRule = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const rule = await AutomationRule.findById(req.params.id);
    if (!rule) { res.status(404).json({ message: 'Rule not found' }); return; }

    const allowed = ['name', 'triggerSegment', 'action', 'messageTemplate', 'cooldownDays', 'batchLimit', 'isActive'];
    for (const key of allowed) {
      if (req.body[key] !== undefined) {
        (rule as any)[key] = req.body[key];
      }
    }
    await rule.save();
    res.json(rule);
  } catch (err) {
    next(err);
  }
};

// ── DELETE /api/automation/rules/:id ─────────────────────────────────────────
export const deleteRule = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const rule = await AutomationRule.findById(req.params.id);
    if (!rule) { res.status(404).json({ message: 'Rule not found' }); return; }
    await rule.deleteOne();
    res.json({ message: 'Rule deleted' });
  } catch (err) {
    next(err);
  }
};

// ── POST /api/automation/rules/:id/run ───────────────────────────────────────
export const runRule = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const rule = await AutomationRule.findById(req.params.id);
    if (!rule) { res.status(404).json({ message: 'Rule not found' }); return; }

    const result = await runAutomationRule(rule);
    res.json(result);
  } catch (err) {
    next(err);
  }
};

// ── POST /api/automation/run-all ─────────────────────────────────────────────
export const runAll = async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const results = await triggerManualRun();
    res.json({ ran: results.length, results });
  } catch (err) {
    next(err);
  }
};

// ── GET /api/automation/logs ──────────────────────────────────────────────────
export const getLogs = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { ruleId, limit = '50' } = req.query as { ruleId?: string; limit?: string };
    const query = ruleId ? { ruleId } : {};
    const logs = await AutomationLog.find(query)
      .sort({ triggeredAt: -1 })
      .limit(Math.min(parseInt(limit, 10), 200))
      .lean();
    res.json(logs);
  } catch (err) {
    next(err);
  }
};
