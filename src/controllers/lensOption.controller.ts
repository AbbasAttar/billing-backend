import { Request, Response, NextFunction } from 'express';
import {
  LensOption,
  LENS_OPTION_KINDS,
  TINT_STYLES,
  DESIGN_BEST_FOR,
  DESIGN_LEVELS,
  type LensOptionKind,
  type TintStyle,
  type DesignBestFor,
  type DesignLevel,
} from '../models/LensOption.model';
import { LensPricing, LENS_TYPES, LENS_MATERIALS, LENS_COLORS, CLEAR_COLOR, isLensName } from '../models/LensPricing.model';
import { LensStock } from '../models/LensStock.model';
import { SiteSetting } from '../models/SiteSetting.model';
import { ok, fail } from '../utils/response';
import { DEFAULT_SHORT_NAMES, effectiveShortName } from '../services/lensShortNames';
import { readAliases, AliasError } from '../services/lensAliases';

type Seed = {
  name: string;
  shortName?: string;
  parent?: string;
  hex?: string;
  value?: number;
  style?: TintStyle;
  description?: string;
  bestFor?: DesignBestFor[];
  level?: DesignLevel;
};

/** Shared designs every company's lenses map onto; brands' own names go in aliases. Wording is editable on Lens Config. */
export const DEFAULT_DESIGNS: Seed[] = [
  { name: 'Standard', parent: 'Single Vision', level: 'basic', bestFor: ['all-round'], description: 'Regular single vision lens.' },
  { name: 'Lenticular', parent: 'Single Vision', level: 'standard', bestFor: [], description: 'For very high powers: power only in the centre zone, thin flat edge around it.' },
  { name: 'Standard', parent: 'Bifocal', shortName: 'KT', level: 'basic', bestFor: ['near'], description: 'Round reading segment (KT) with a visible line; budget bifocal.' },
  { name: 'D-Shape', parent: 'Bifocal', level: 'basic', bestFor: ['near', 'office'], description: 'Flat-top D segment; wider reading area at the top of the segment.' },
  { name: 'Smart (Invisible)', parent: 'Bifocal', level: 'standard', bestFor: ['near'], description: 'Blended reading segment with no visible line.' },
  { name: 'Standard', parent: 'Progressive', level: 'basic', bestFor: ['all-round'], description: 'Entry progressive: distance to near in one lens, narrower clear zones.' },
  { name: 'Near Comfort', parent: 'Progressive', level: 'standard', bestFor: ['near', 'office'], description: 'Bigger reading and intermediate zones for desk and close work.' },
  { name: 'Wide Corridor', parent: 'Progressive', level: 'standard', bestFor: ['driving', 'all-round'], description: 'Wider middle corridor and softer sides for moving around and driving.' },
  { name: 'Digital', parent: 'Progressive', level: 'standard', bestFor: ['all-round', 'office'], description: 'Freeform (digitally surfaced) design: wider clear zones, less side blur.' },
  { name: '4K', parent: 'Progressive', level: 'premium', bestFor: ['all-round'], description: 'Higher-definition freeform design; sharper vision towards the sides.' },
  { name: '8K', parent: 'Progressive', level: 'premium', bestFor: ['all-round', 'first-time'], description: 'Top-definition freeform design; easiest to adapt to.' },
  { name: 'AI', parent: 'Progressive', level: 'premium', bestFor: ['all-round', 'first-time'], description: 'Personalised design computed per wearer; top of the range.' },
];

const named = (names: readonly string[]): Seed[] => names.map((name) => ({ name }));
const step = (style: TintStyle, value: number) => ({ name: style === 'solid' ? `${value}%` : `${value}→0`, style, value });

/** What each list starts with the first time it is read (docs/lens-price-book-v2-plan.md, "Lens model v2"). */
const DEFAULTS: Record<LensOptionKind, Seed[]> = {
  material: named(LENS_MATERIALS),
  index: [
    ...[1.5, 1.56, 1.61, 1.67, 1.74].map((value) => ({ name: value.toFixed(2), value, parent: 'Fiber' })),
    { name: '1.59', value: 1.59, parent: 'Polycarbonate' },
  ],
  design: DEFAULT_DESIGNS,
  photoColor: [
    { name: 'Grey', shortName: 'PG', hex: '#6b7280' },
    { name: 'Brown', shortName: 'PB', hex: '#8b5a2b' },
    { name: 'Blue', hex: '#2563eb' },
    { name: 'Green', hex: '#16a34a' },
    { name: 'Amber', hex: '#f59e0b' },
    { name: 'Red', hex: '#dc2626' },
    { name: 'Purple', hex: '#7c3aed' },
    { name: 'Pink', hex: '#ec4899' },
  ],
  tintColor: [
    { name: 'Grey', hex: '#6b7280' },
    { name: 'Brown', hex: '#8b5a2b' },
    { name: 'Green', hex: '#4d7c0f' },
    { name: 'Blue', hex: '#1d4ed8' },
    { name: 'Pink', hex: '#db2777' },
    { name: 'Purple', hex: '#6d28d9' },
    { name: 'Yellow', hex: '#eab308' },
  ],
  tintStep: [
    ...[25, 50, 75, 85].map((v) => step('solid', v)),
    ...[80, 70, 60, 50, 40, 30].map((v) => step('gradient', v)),
  ],
  mirrorColor: [{ name: 'Silver', hex: '#c0c0c0' }],
  color: named(LENS_COLORS),
};

const SETTINGS_KEY = 'lens_config';
interface LensConfigSettings { allowFinishOnPhoto: boolean }
const DEFAULT_SETTINGS: LensConfigSettings = { allowFinishOnPhoto: false };

const LABEL: Record<LensOptionKind, string> = {
  material: 'material', index: 'index', design: 'design', photoColor: 'photochromic colour',
  tintColor: 'tint colour', tintStep: 'tint step', mirrorColor: 'mirror colour', color: 'colour',
};
/** Kinds whose names bills, pricing rules and stock store today — renaming or deleting a used one would orphan them. */
const STORED_KINDS: LensOptionKind[] = ['material', 'color'];

const clean = (v: unknown) => String(v ?? '').trim().replace(/\s+/g, ' ');
const lower = (v: unknown) => String(v ?? '').toLowerCase();
const isClear = (kind: LensOptionKind, name: string) => kind === 'color' && lower(name) === lower(CLEAR_COLOR);

class BadInput extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}

const MAX_SHORT = 12;
/** Short name from the request: undefined = not sent, '' = print nothing on lens slips. */
function readShortName(v: unknown): string | undefined {
  if (v === undefined) return undefined;
  const short = clean(v);
  if (short.length > MAX_SHORT) throw new BadInput(`short name must be at most ${MAX_SHORT} characters`);
  return short;
}

function readHex(v: unknown): string | null | undefined {
  if (v === undefined) return undefined;
  if (v === null || v === '') return null;
  const hex = clean(v).toLowerCase();
  if (!/^#[0-9a-f]{6}$/.test(hex)) throw new BadInput('colour must look like #a1b2c3');
  return hex;
}

/** API shape: the short name actually printed, so the screen shows defaults for older entries. */
const view = (o: any) => ({
  _id: o._id,
  kind: o.kind,
  name: o.name,
  shortName: effectiveShortName(o),
  parent: o.parent ?? null,
  company: o.company ?? null,
  aliases: o.aliases ?? [],
  description: o.description ?? null,
  bestFor: o.bestFor ?? [],
  level: o.level ?? null,
  hex: o.hex ?? null,
  value: o.value ?? null,
  style: o.style ?? null,
});

/** Same entry = same kind, parent, company and name (tint steps: same style and percent). */
function sameSlot(a: any, b: any): boolean {
  if (a.kind !== b.kind || lower(a.parent ?? '') !== lower(b.parent ?? '') || lower(a.company ?? '') !== lower(b.company ?? '')) return false;
  if (a.kind === 'tintStep') return a.style === b.style && Number(a.value) === Number(b.value);
  return lower(a.name) === lower(b.name);
}

async function inUse(kind: LensOptionKind, name: string): Promise<boolean> {
  if (!STORED_KINDS.includes(kind)) return false;
  const [rule, stock] = await Promise.all([LensPricing.exists({ [kind]: name }), LensStock.exists({ [kind]: name })]);
  return Boolean(rule || stock);
}

async function readSettings(): Promise<LensConfigSettings> {
  const doc: any = await SiteSetting.findOne({ key: SETTINGS_KEY }).lean();
  return { ...DEFAULT_SETTINGS, ...(doc?.value ?? {}) };
}

/** The fields each kind needs, from the request over the current entry. Throws BadInput when something is wrong. */
async function readFields(kind: LensOptionKind, body: any, current?: any): Promise<Record<string, any>> {
  const out: Record<string, any> = {};
  if (body.name !== undefined) out.name = clean(body.name);
  const parentRaw = body.parent !== undefined ? clean(body.parent) : current?.parent;

  if (kind === 'index') {
    const materials: any[] = await LensOption.find({ kind: 'material' }).lean();
    const material = materials.find((m) => lower(m.name) === lower(parentRaw));
    if (!material) throw new BadInput('Pick the material this index belongs to');
    out.parent = material.name;
    const name = out.name ?? current?.name ?? '';
    const value = body.value !== undefined && body.value !== null && body.value !== '' ? Number(body.value) : parseFloat(name);
    if (!Number.isFinite(value) || value < 1.4 || value > 2) throw new BadInput('index must be a number like 1.56');
    out.value = value;
    out.name = name || value.toFixed(2);
  } else if (kind === 'design') {
    const type = LENS_TYPES.find((t) => lower(t) === lower(parentRaw));
    if (!type) throw new BadInput('Pick the lens type this design belongs to');
    out.parent = type;
  } else if (kind === 'tintStep') {
    const style = (body.style ?? current?.style) as TintStyle;
    if (!TINT_STYLES.includes(style)) throw new BadInput('style must be solid or gradient');
    const value = Number(body.value ?? current?.value);
    if (!Number.isInteger(value) || value < 5 || value > 100) throw new BadInput('percent must be a whole number from 5 to 100');
    Object.assign(out, step(style, value));
  }

  if (kind === 'design') {
    if (body.description !== undefined) {
      const description = clean(body.description);
      if (description.length > 160) throw new BadInput('description must be at most 160 characters');
      out.description = description || null;
    }
    if (body.bestFor !== undefined) {
      if (!Array.isArray(body.bestFor)) throw new BadInput('bestFor must be a list');
      out.bestFor = DESIGN_BEST_FOR.filter((t) => body.bestFor.includes(t));
    }
    if (body.level !== undefined) {
      if (body.level !== null && !DESIGN_LEVELS.includes(body.level)) throw new BadInput('level must be basic, standard or premium');
      out.level = body.level;
    }
  }
  try {
    const aliases = readAliases(body.aliases);
    if (aliases !== undefined) out.aliases = aliases;
  } catch (e) {
    if (e instanceof AliasError) throw new BadInput(e.message);
    throw e;
  }
  if (kind === 'photoColor' || kind === 'tintColor' || kind === 'mirrorColor') {
    const hex = readHex(body.hex);
    if (hex !== undefined) out.hex = hex;
  }
  const shortName = readShortName(body.shortName);
  if (shortName !== undefined) out.shortName = shortName;
  return out;
}

async function assertFree(candidate: any, exceptId?: string) {
  const siblings: any[] = await LensOption.find({ kind: candidate.kind }).lean();
  if (siblings.some((o) => String(o._id) !== exceptId && sameSlot(o, candidate))) {
    throw new BadInput(`This ${LABEL[candidate.kind as LensOptionKind]} is already in the list`, 409);
  }
}

const listOf = (all: any[], kind: LensOptionKind) =>
  all
    .filter((o) => o.kind === kind)
    .sort(
      (a, b) =>
        lower(a.company ?? '').localeCompare(lower(b.company ?? '')) ||
        lower(a.parent ?? '').localeCompare(lower(b.parent ?? '')) ||
        String(a.style ?? '').localeCompare(String(b.style ?? '')) ||
        (kind === 'tintStep' || kind === 'index' ? Number(a.value) - Number(b.value) : String(a.name).localeCompare(String(b.name))),
    )
    .map(view);

/**
 * GET /lens-options → every Lens Config list plus settings. A list nobody has saved yet starts with its defaults.
 * `materials` and `colors` keep their names for the screens that already read them.
 */
export const getLensOptions = async (_req: Request, res: Response, next: NextFunction) => {
  try {
    let all: any[] = await LensOption.find().lean();
    const missing = LENS_OPTION_KINDS.filter((k) => !all.some((o) => o.kind === k));
    if (missing.length) {
      await LensOption.insertMany(
        missing.flatMap((kind) =>
          DEFAULTS[kind].map((s) => ({ kind, ...s, shortName: s.shortName ?? DEFAULT_SHORT_NAMES[kind]?.[s.name] ?? '' })),
        ),
      );
      all = await LensOption.find().lean();
    }
    return ok(res, {
      materials: listOf(all, 'material'),
      indices: listOf(all, 'index'),
      designs: listOf(all, 'design'),
      photoColors: listOf(all, 'photoColor'),
      tintColors: listOf(all, 'tintColor'),
      tintSteps: listOf(all, 'tintStep'),
      mirrorColors: listOf(all, 'mirrorColor'),
      colors: listOf(all, 'color'),
      settings: await readSettings(),
    });
  } catch (e) { next(e); }
};

/** PUT /lens-options/settings { allowFinishOnPhoto? } */
export const updateLensConfigSettings = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const settings = await readSettings();
    if (req.body?.allowFinishOnPhoto !== undefined) settings.allowFinishOnPhoto = req.body.allowFinishOnPhoto === true;
    await SiteSetting.findOneAndUpdate({ key: SETTINGS_KEY }, { $set: { value: settings } }, { upsert: true, new: true });
    return ok(res, settings, 'Saved');
  } catch (e) { next(e); }
};

/** POST /lens-options { kind, name, shortName?, parent?, hex?, value?, style?, aliases?, description?, bestFor?, level? } */
export const createLensOption = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const kind = req.body?.kind as LensOptionKind;
    if (!LENS_OPTION_KINDS.includes(kind)) return fail(res, 'Unknown list', 400);
    const candidate: Record<string, any> = { kind, shortName: '', ...(await readFields(kind, req.body ?? {})) };
    if (!isLensName(candidate.name)) return fail(res, 'name is required (max 40 characters)', 400);
    await assertFree(candidate);
    const option = await LensOption.create(candidate as any);
    return ok(res, view(option), 'Added', 201);
  } catch (e) {
    if (e instanceof BadInput) return fail(res, e.message, e.status);
    next(e);
  }
};

/** PUT /lens-options/:id — short name, swatch, brand names and design details can always change; a stored name only while unused. */
export const updateLensOption = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const option: any = await LensOption.findById(req.params.id);
    if (!option) return fail(res, 'Not found', 404);
    const fields = await readFields(option.kind, req.body ?? {}, option);
    const name: string = fields.name ?? option.name;
    if (!isLensName(name)) return fail(res, 'name is required (max 40 characters)', 400);

    const oldName: string = option.name;
    const renamed = name !== oldName;
    if (renamed) {
      if (isClear(option.kind, oldName)) return fail(res, `"${CLEAR_COLOR}" is the clear lens colour and cannot be renamed`, 400);
      if (await inUse(option.kind, oldName)) {
        return fail(res, `Cannot rename — "${oldName}" is used in lens pricing rules or stock. Add the new name instead.`, 409);
      }
    }
    await assertFree(
      { kind: option.kind, parent: option.parent, company: option.company, style: option.style, value: option.value, ...fields, name },
      String(option._id),
    );

    Object.assign(option, fields, { name });
    await option.save();
    // Indices hang off their material by name.
    if (renamed && option.kind === 'material') {
      await LensOption.updateMany({ kind: 'index', parent: oldName }, { $set: { parent: name } });
    }
    return ok(res, view(option), 'Updated');
  } catch (e) {
    if (e instanceof BadInput) return fail(res, e.message, e.status);
    next(e);
  }
};

/** DELETE /lens-options/:id — a material takes its indices with it. */
export const deleteLensOption = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const option = await LensOption.findById(req.params.id);
    if (!option) return fail(res, 'Not found', 404);
    if (isClear(option.kind, option.name)) return fail(res, `"${CLEAR_COLOR}" is the clear lens colour and cannot be removed`, 400);
    if (await inUse(option.kind, option.name)) {
      return fail(res, `Cannot delete — "${option.name}" is used in lens pricing rules or stock`, 409);
    }
    await LensOption.findByIdAndDelete(req.params.id);
    if (option.kind === 'material') await LensOption.deleteMany({ kind: 'index', parent: option.name });
    return ok(res, { _id: option._id }, 'Deleted');
  } catch (e) { next(e); }
};
