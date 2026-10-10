import { Request, Response, NextFunction } from 'express';
import { WholesaleCompany } from '../models/WholesaleCompany.model';
import { WholesaleItem } from '../models/WholesaleItem.model';
import { ok, fail } from '../utils/response';

const norm = (s: string) => s.trim().replace(/\s+/g, ' ');

/** True when another company already has this name (case-insensitive). */
async function nameTaken(name: string, exceptId?: string): Promise<boolean> {
  const all = await WholesaleCompany.find();
  const key = name.toLowerCase();
  return all.some((c: any) => String(c._id ?? c.id) !== exceptId && (c.name || '').toLowerCase() === key);
}

export const getWholesaleCompanies = async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const companies = await WholesaleCompany.find();
    companies.sort((a: any, b: any) => (a.name || '').localeCompare(b.name || ''));
    return ok(res, companies);
  } catch (e) { next(e); }
};

export const createWholesaleCompany = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const name = typeof req.body?.name === 'string' ? norm(req.body.name) : '';
    if (!name) return fail(res, 'name is required', 400);
    if (await nameTaken(name)) return fail(res, `Company "${name}" already exists`, 409);
    const company = await WholesaleCompany.create({ name });
    return ok(res, company, 'Company created', 201);
  } catch (e) { next(e); }
};

/** Renaming a company also renames it on every wholesale item that uses it. */
export const updateWholesaleCompany = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = String(req.params.id);
    const name = typeof req.body?.name === 'string' ? norm(req.body.name) : '';
    if (!name) return fail(res, 'name is required', 400);
    if (await nameTaken(name, id)) return fail(res, `Company "${name}" already exists`, 409);
    const company = await WholesaleCompany.findByIdAndUpdate(id, { name }, { new: true });
    if (!company) return fail(res, 'Company not found', 404);
    await WholesaleItem.updateMany({ companyId: id }, { $set: { companyName: name } });
    return ok(res, company);
  } catch (e) { next(e); }
};

/** Only a company no wholesale item uses (archived ones included) can be deleted. */
export const deleteWholesaleCompany = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = String(req.params.id);
    const company = await WholesaleCompany.findById(id);
    if (!company) return fail(res, 'Company not found', 404);
    const used = await WholesaleItem.find({ companyId: id });
    if (used.length > 0) {
      return fail(res, `"${company.name}" is used by ${used.length} wholesale item(s). Move them to another company first.`, 409);
    }
    await WholesaleCompany.findByIdAndDelete(id);
    return ok(res, { _id: id }, 'Company deleted');
  } catch (e) { next(e); }
};
