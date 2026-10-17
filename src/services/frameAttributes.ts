/**
 * Frame attributes for sales logging: what kind of frame sold (category, rim, shape, material,
 * gender), and which piece of it (colour, eye size, reading power).
 *
 * Where each attribute lives on a frame record (one place each, no copies):
 *   category  → frame.category            (optical / sunglass / reading / kids)
 *   rim       → frame.type                 (Full Rim / Half Rim / Rimless)
 *   shape, material, gender, color → frame.web.*
 *   size      → frame.web.frameSize.lensWidth (eye size, mm)
 *   a colour / size / power variant → frame.web.frameVariants[] (colors, size, power)
 *
 * Each bill line keeps a snapshot (`frameAttrs`) of what was sold. Reports read the snapshot first
 * and fill gaps from the frame record, so tagging a model later also fixes its older sales.
 */

import { isCatchAllFrame } from './catchAllProducts';
import { frameVariantName } from './invoiceLineProduct';

export const FRAME_CATEGORIES = ['optical', 'sunglass', 'reading', 'kids'] as const;
export type FrameCategory = (typeof FRAME_CATEGORIES)[number];

export interface FrameAttrs {
  category?: FrameCategory;
  rim?: string;
  shape?: string;
  material?: string;
  gender?: string;
  color?: string;
  /** Eye size (lens width) in mm, e.g. 52. */
  size?: number;
  /** Reading power in dioptres, e.g. 1.5 for +1.50. */
  power?: number;
}

export const ATTR_KEYS = ['category', 'rim', 'shape', 'material', 'gender', 'color', 'size', 'power'] as const;
export type AttrKey = (typeof ATTR_KEYS)[number];

/** Attributes that describe the model (same for every piece), so a sale can teach them to the frame record. */
const MODEL_KEYS = ['category', 'rim', 'shape', 'material', 'gender'] as const;

const text = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
const num = (v: unknown) => {
  const n = typeof v === 'string' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : undefined;
};
const category = (v: unknown): FrameCategory | undefined => {
  const s = text(v)?.toLowerCase();
  return (FRAME_CATEGORIES as readonly string[]).includes(s ?? '') ? (s as FrameCategory) : undefined;
};

/** Clean attributes sent by the counter: unknown keys and empty values dropped. */
export function cleanFrameAttrs(input: unknown): FrameAttrs {
  if (!input || typeof input !== 'object') return {};
  const a = input as Record<string, unknown>;
  const out: FrameAttrs = {
    category: category(a.category),
    rim: text(a.rim),
    shape: text(a.shape),
    material: text(a.material),
    gender: text(a.gender)?.toLowerCase(),
    color: text(a.color),
    size: num(a.size),
    power: num(a.power),
  };
  for (const k of ATTR_KEYS) if (out[k] === undefined) delete out[k];
  return out;
}

/** Category for frames entered before categories existed: read from the name or rim type. */
function guessCategory(f: any): FrameCategory | undefined {
  const s = `${f?.name ?? ''} ${f?.houseName ?? ''} ${f?.type ?? ''}`.toLowerCase();
  if (/\breading\b|\breader/.test(s)) return 'reading';
  if (/\bsun|goggle/.test(s)) return 'sunglass';
  return undefined;
}

/** The variant a bill line picked, by the same name the counter shows. */
export function findFrameVariant(frame: any, label?: string | null) {
  if (!label) return undefined;
  return (frame?.web?.frameVariants ?? []).find((v: any) => frameVariantName(v) === label);
}

/** Attributes recorded on a frame (and the picked variant, if any). Missing ones stay undefined. */
export function frameDocAttrs(frame: any, variantLabel?: string | null): FrameAttrs {
  if (!frame) return {};
  const v = findFrameVariant(frame, variantLabel);
  const variantColor = v?.colors?.length ? v.colors.map((c: any) => c.name).join(' + ') : undefined;
  return cleanFrameAttrs({
    category: frame.category ?? guessCategory(frame),
    rim: frame.type,
    shape: frame.web?.shape,
    material: frame.web?.material,
    gender: frame.web?.gender,
    color: variantColor ?? frame.web?.color,
    size: v?.size ?? frame.web?.frameSize?.lensWidth,
    power: v?.power,
  });
}

/** What a sold line was: its own snapshot first, gaps filled from the frame record. */
export function lineFrameAttrs(line: { frameAttrs?: unknown; frameVariantLabel?: string | null }, frame: any): FrameAttrs {
  return { ...frameDocAttrs(frame, line.frameVariantLabel), ...cleanFrameAttrs(line.frameAttrs) };
}

/**
 * Model attributes the counter tagged that the frame record does not have yet, as a `$set`.
 * Never overwrites what is already recorded; catch-all frames are not taught anything.
 */
export function learnFromSale(frame: any, attrs: FrameAttrs): Record<string, unknown> {
  if (!frame || isCatchAllFrame(frame)) return {};
  const set: Record<string, unknown> = {};
  // A guessed category is not recorded, so a tagged one may still be saved.
  const has: FrameAttrs = { ...frameDocAttrs(frame), category: category(frame.category) };
  for (const k of MODEL_KEYS) {
    if (attrs[k] === undefined || has[k] !== undefined) continue;
    if (k === 'category') set.category = attrs.category;
    else if (k === 'rim') set.type = attrs.rim;
    else set[`web.${k}`] = attrs[k];
  }
  // Eye size belongs to the model unless its variants carry their own sizes.
  const variantSizes = (frame.web?.frameVariants ?? []).some((v: any) => num(v.size));
  if (attrs.size !== undefined && !variantSizes && !num(frame.web?.frameSize?.lensWidth)) set['web.frameSize.lensWidth'] = attrs.size;
  return set;
}

/** Snapshot stored on a new frame bill line. */
export function saleSnapshot(frame: any, variantLabel: string | null | undefined, sent: unknown): FrameAttrs {
  return { ...frameDocAttrs(frame, variantLabel), ...cleanFrameAttrs(sent) };
}

/** Model attributes still missing on a frame, in the order the tag queue asks for them. */
export function missingModelAttrs(frame: any): AttrKey[] {
  const a = frameDocAttrs(frame);
  const out: AttrKey[] = [];
  if (!frame?.category && !a.category) out.push('category');
  for (const k of ['shape', 'material'] as const) if (a[k] === undefined) out.push(k);
  if (a.category !== 'reading' && a.size === undefined && !(frame?.web?.frameVariants ?? []).some((v: any) => num(v.size))) out.push('size');
  if (a.color === undefined && !(frame?.web?.frameVariants ?? []).length) out.push('color');
  return out;
}

/** `$set` that records tagged attributes on a frame (the tag queue: overwrites what is there). */
export function tagFrameSet(attrs: FrameAttrs): Record<string, unknown> {
  const set: Record<string, unknown> = {};
  if (attrs.category) set.category = attrs.category;
  if (attrs.rim) set.type = attrs.rim;
  for (const k of ['shape', 'material', 'gender', 'color'] as const) if (attrs[k]) set[`web.${k}`] = attrs[k];
  if (attrs.size) set['web.frameSize.lensWidth'] = attrs.size;
  return set;
}
