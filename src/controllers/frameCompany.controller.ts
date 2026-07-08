import { Request, Response, NextFunction } from 'express';
import { FrameCompany } from '../models/FrameCompany.model';
import { ok, fail } from '../utils/response';

export const getAll = async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const companies = await FrameCompany.find().sort({ code: 1 });
    return ok(res, companies);
  } catch (e) { next(e); }
};

export const create = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { code, name } = req.body as { code?: string; name?: string };
    if (!code?.trim()) return fail(res, 'code is required', 400);
    if (!/^\d{2}$/.test(code.trim())) return fail(res, 'code must be exactly 2 digits', 400);
    if (!name?.trim()) return fail(res, 'name is required', 400);

    const company = await FrameCompany.create({ code: code.trim(), name: name.trim() });
    return ok(res, company, 'Company created', 201);
  } catch (e: any) {
    if (e.code === 11000) return fail(res, 'A company with this code already exists', 409);
    next(e);
  }
};

export const update = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { name } = req.body as { name?: string };
    if (!name?.trim()) return fail(res, 'name is required', 400);

    const company = await FrameCompany.findByIdAndUpdate(
      req.params.id,
      { name: name.trim() },
      { new: true, runValidators: true }
    );
    if (!company) return fail(res, 'Company not found', 404);
    return ok(res, company, 'Updated');
  } catch (e) { next(e); }
};

export const remove = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const company = await FrameCompany.findByIdAndDelete(req.params.id);
    if (!company) return fail(res, 'Company not found', 404);
    return ok(res, { _id: company._id }, 'Deleted');
  } catch (e) { next(e); }
};
