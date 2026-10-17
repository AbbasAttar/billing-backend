/**
 * Frame attributes for sales logging: what kind of frame sold (category, rim, shape, material,
 * gender, reading lens type), and which piece of it (colour, eye size, reading addition).
 *
 * Where each attribute lives on a frame record (one place each, no copies):
 *   category, readingType → frame.category, frame.readingType
 *   rim       → frame.type                 (Full Rim / Half Rim / Rimless)
 *   shape, material, gender → frame.web.*
 *   colours the model comes in → frame.web.colors[] (older records: frame.web.color)
 *   eye sizes the model comes in → frame.web.sizes[] (older records: frame.web.frameSize.lensWidth)
 *   a piece with its own stock → frame.web.frameVariants[] (colors, size, readingType, power)
 *
 * Each bill line keeps a snapshot (`frameAttrs`) of the one piece sold. Reports read the snapshot
 * first and fill gaps from the frame record, so tagging a model later also fixes its older sales.
 * A model with several colours (or sizes) cannot say which one a sale was, so those stay unknown
 * unless the line or its variant says.
 */

import { isCatchAllFrame } from './catchAllProducts';
import { frameVariantName } from './invoiceLineProduct';

export const FRAME_CATEGORIES = ['optical', 'sunglass', 'reading', 'kids'] as const;
export type FrameCategory = (typeof FRAME_CATEGORIES)[number];
export const READING_TYPES = ['Single Vision', 'Bifocal', 'Progressive'] as const;
export type ReadingType = (typeof READING_TYPES)[number];

export interface FrameAttrs {
  category?: FrameCategory;
  /** Reading glasses: Single Vision / Bifocal / Progressive. */
  readingType?: ReadingType;
  rim?: string;
  shape?: string;
  material?: string;
  gender?: string;
  color?: string;
  /** Eye size (lens width) in mm, e.g. 52. */
  size?: number;
  /** Reading power (addition) in dioptres, +1.00…+3.00, e.g. 1.5 for +1.50. */
  power?: number;
}

export const ATTR_KEYS = ['category', 'readingType', 'rim', 'shape', 'material', 'gender', 'color', 'size', 'power'] as const;
export type AttrKey = (typeof ATTR_KEYS)[number];

/** Attributes that describe the model (same for every piece), so a sale can teach them to the frame record. */
const MODEL_KEYS = ['category', 'readingType', 'rim', 'shape', 'material', 'gender'] as const;

/** Swatch colours for common frame colour names (the shared palette wins when it has the name). */
const COLOR_HEX: Record<string, string> = {
  black: '#000000', gold: '#d4af37', silver: '#c0c0c0', brown: '#6b4423', gunmetal: '#53565a',
  transparent: '#e5e7eb', blue: '#1e3a8a', tortoise: '#8b5a2b', 'rose gold': '#b76e79', red: '#b91c1c',
  white: '#ffffff', grey: '#6b7280', gray: '#6b7280', green: '#166534', pink: '#ec4899', purple: '#6b21a8',
};
export const swatchFor = (name: string, palette?: Map<string, string>) => ({
  name,
  hex: palette?.get(name.toLowerCase()) ?? COLOR_HEX[name.toLowerCase()] ?? '#9ca3af',
});

const text = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
const num = (v: unknown) => {
  const n = typeof v === 'string' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : undefined;
};
/** Reading power: plus (addition) only; minus readymade glasses are not stocked. */
const power = num;
/** "+1.50": the sign is always shown. */
export const formatPower = (p: number) => `${p > 0 ? '+' : '-'}${Math.abs(p).toFixed(2)}`;
const category = (v: unknown): FrameCategory | undefined => {
  const s = text(v)?.toLowerCase();
  return (FRAME_CATEGORIES as readonly string[]).includes(s ?? '') ? (s as FrameCategory) : undefined;
};
const readingType = (v: unknown): ReadingType | undefined => {
  const s = text(v)?.toLowerCase();
  return READING_TYPES.find((t) => t.toLowerCase() === s);
};
const uniq = <T>(xs: T[]) => [...new Set(xs)];

/** Clean attributes sent by the counter: unknown keys and empty values dropped. */
export function cleanFrameAttrs(input: unknown): FrameAttrs {
  if (!input || typeof input !== 'object') return {};
  const a = input as Record<string, unknown>;
  const out: FrameAttrs = {
    category: category(a.category),
    readingType: readingType(a.readingType),
    rim: text(a.rim),
    shape: text(a.shape),
    material: text(a.material),
    gender: text(a.gender)?.toLowerCase(),
    color: text(a.color),
    size: num(a.size),
    power: power(a.power),
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

/** Colours the model comes in (its list, else the older single colour). */
export function modelColors(frame: any): string[] {
  const list = (frame?.web?.colors ?? []).map((c: any) => text(c?.name)).filter(Boolean) as string[];
  if (list.length) return uniq(list);
  const one = text(frame?.web?.color);
  return one ? [one] : [];
}

/** Eye sizes the model comes in (its list, else the older single lens width). */
export function modelSizes(frame: any): number[] {
  const list = (frame?.web?.sizes ?? []).map(num).filter(Boolean) as number[];
  if (list.length) return uniq(list).sort((a, b) => a - b);
  const one = num(frame?.web?.frameSize?.lensWidth);
  return one ? [one] : [];
}

/** The variant a bill line picked, by the same name the counter shows. */
export function findFrameVariant(frame: any, label?: string | null) {
  if (!label) return undefined;
  return (frame?.web?.frameVariants ?? []).find((v: any) => frameVariantName(v) === label);
}

/** Attributes recorded on a frame (and the picked variant, if any). Missing or ambiguous ones stay undefined. */
export function frameDocAttrs(frame: any, variantLabel?: string | null): FrameAttrs {
  if (!frame) return {};
  const v = findFrameVariant(frame, variantLabel);
  const variantColor = v?.colors?.length ? v.colors.map((c: any) => c.name).join(' + ') : undefined;
  const colors = modelColors(frame);
  const sizes = modelSizes(frame);
  return cleanFrameAttrs({
    category: frame.category ?? guessCategory(frame),
    readingType: v?.readingType ?? frame.readingType,
    rim: frame.type,
    shape: frame.web?.shape,
    material: frame.web?.material,
    gender: frame.web?.gender,
    color: variantColor ?? (colors.length === 1 ? colors[0] : undefined),
    size: v?.size ?? (sizes.length === 1 ? sizes[0] : undefined),
    power: v?.power,
  });
}

/** What a sold line was: its own snapshot first, gaps filled from the frame record. */
export function lineFrameAttrs(line: { frameAttrs?: unknown; frameVariantLabel?: string | null }, frame: any): FrameAttrs {
  return { ...frameDocAttrs(frame, line.frameVariantLabel), ...cleanFrameAttrs(line.frameAttrs) };
}

const hasVariants = (frame: any) => (frame?.web?.frameVariants ?? []).length > 0;

/**
 * Model details the counter tagged that the frame record does not have yet, as a `$set`.
 * Never overwrites what is recorded; a colour or eye size not yet on the model is added to its
 * list (models with variants keep their variants as the list). Catch-all frames learn nothing.
 */
export function learnFromSale(frame: any, attrs: FrameAttrs): Record<string, unknown> {
  if (!frame || isCatchAllFrame(frame)) return {};
  const set: Record<string, unknown> = {};
  // A guessed category is not recorded, so a tagged one may still be saved.
  const has: FrameAttrs = { ...frameDocAttrs(frame), category: category(frame.category), readingType: readingType(frame.readingType) };
  for (const k of MODEL_KEYS) {
    if (attrs[k] === undefined || has[k] !== undefined) continue;
    if (k === 'category' || k === 'readingType') set[k] = attrs[k];
    else if (k === 'rim') set.type = attrs.rim;
    else set[`web.${k}`] = attrs[k];
  }
  if (!hasVariants(frame)) {
    const colors = modelColors(frame);
    if (attrs.color && !colors.some((c) => c.toLowerCase() === attrs.color!.toLowerCase())) {
      set['web.colors'] = [...colors, attrs.color].map((c) => swatchFor(c));
    }
    const sizes = modelSizes(frame);
    if (attrs.size && !sizes.includes(attrs.size)) set['web.sizes'] = [...sizes, attrs.size].sort((a, b) => a - b);
  }
  return set;
}

/** Snapshot stored on a new frame bill line. */
export function saleSnapshot(frame: any, variantLabel: string | null | undefined, sent: unknown): FrameAttrs {
  return { ...frameDocAttrs(frame, variantLabel), ...cleanFrameAttrs(sent) };
}

export type QueueKey = 'category' | 'readingType' | 'shape' | 'material' | 'size' | 'color';

/** Model details still missing on a frame, in the order the tag queue asks for them. */
export function missingModelAttrs(frame: any): QueueKey[] {
  const a = frameDocAttrs(frame);
  const variants: any[] = frame?.web?.frameVariants ?? [];
  const out: QueueKey[] = [];
  if (!frame?.category && !a.category) out.push('category');
  if (a.category === 'reading' && !readingType(frame?.readingType) && !variants.some((v) => readingType(v.readingType))) out.push('readingType');
  for (const k of ['shape', 'material'] as const) if (a[k] === undefined) out.push(k);
  if (a.category !== 'reading' && !modelSizes(frame).length && !variants.some((v) => num(v.size))) out.push('size');
  if (!modelColors(frame).length && !variants.some((v) => v.colors?.length)) out.push('color');
  return out;
}

/** Tags from the tag queue: single details plus the model's colour and size lists. */
export interface FrameTagInput extends FrameAttrs {
  colors?: string[];
  sizes?: number[];
}

export function cleanTagInput(input: unknown): FrameTagInput {
  const out: FrameTagInput = cleanFrameAttrs(input);
  const a = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  if (Array.isArray(a.colors)) out.colors = uniq(a.colors.map(text).filter(Boolean) as string[]);
  if (Array.isArray(a.sizes)) out.sizes = uniq(a.sizes.map(num).filter(Boolean) as number[]).sort((x, y) => x - y);
  return out;
}

/** `$set` that records tags on a frame (the tag queue: overwrites what is there). */
export function tagFrameSet(tags: FrameTagInput, palette?: Map<string, string>): Record<string, unknown> {
  const set: Record<string, unknown> = {};
  if (tags.category) set.category = tags.category;
  if (tags.readingType) set.readingType = tags.readingType;
  if (tags.rim) set.type = tags.rim;
  for (const k of ['shape', 'material', 'gender'] as const) if (tags[k]) set[`web.${k}`] = tags[k];
  const colors = tags.colors ?? (tags.color ? [tags.color] : undefined);
  if (colors) set['web.colors'] = colors.map((c) => swatchFor(c, palette));
  const sizes = tags.sizes ?? (tags.size ? [tags.size] : undefined);
  if (sizes) set['web.sizes'] = sizes;
  return set;
}
