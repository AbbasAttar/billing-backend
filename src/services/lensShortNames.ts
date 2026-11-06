/**
 * Short codes for lens slips (lensPrint.xlsx rows, today's invoices export): "PG CR Blue Cut KT".
 * Materials and colours come from Settings → Lens Config; coatings from the Coating list.
 */
import { Coating } from '../models/Coating.model';
import { LensOption, type ILensOption, type LensOptionKind } from '../models/LensOption.model';

/** Codes the shop used before they were editable; still used for entries never given a short name. */
export const DEFAULT_SHORT_NAMES: Partial<Record<LensOptionKind, Record<string, string>>> = {
  material: { Fiber: 'CR', Glass: 'Glass', Polycarbonate: 'PC' },
  color: { 'Photo Chromatic': 'PG', Polarized: 'Polarize' },
};

/** Stored short name, else the default for that name, else '' (nothing printed). */
export function effectiveShortName(option: Pick<ILensOption, 'kind' | 'name' | 'shortName'>): string {
  if (typeof option.shortName === 'string') return option.shortName;
  return DEFAULT_SHORT_NAMES[option.kind]?.[option.name] ?? '';
}

export interface LensShortNames {
  coating: Map<string, string>;
  material: Map<string, string>;
  color: Map<string, string>;
}

export async function getLensShortNames(): Promise<LensShortNames> {
  const [coatings, options] = await Promise.all([Coating.find().lean(), LensOption.find().lean()]);
  const out: LensShortNames = { coating: new Map(), material: new Map(), color: new Map() };
  for (const c of coatings as any[]) if (c.shortName) out.coating.set(c.name, c.shortName);
  for (const o of options as any[]) {
    if (o.kind === 'material' || o.kind === 'color') out[o.kind as 'material' | 'color'].set(o.name, effectiveShortName(o));
  }
  return out;
}

const emptyShortNames = (): LensShortNames => ({ coating: new Map(), material: new Map(), color: new Map() });

/** Colour, material, coating, then type: e.g. "PG CR Blue Cut KT". */
export function buildLensName(item: any, shorts: LensShortNames = emptyShortNames()): string {
  const parts: string[] = [];
  const short = (map: Map<string, string>, kind: LensOptionKind, name: string) =>
    map.has(name) ? map.get(name)! : effectiveShortName({ kind, name });

  const color = (item.lensColor ?? '').trim();
  const colorShort = color ? short(shorts.color, 'color', color) : '';
  if (colorShort) parts.push(colorShort);
  else if (/gradal/i.test(color)) parts.push('GRD');

  const material = (item.lensMaterial ?? '').trim();
  const materialShort = material ? short(shorts.material, 'material', material) : '';
  if (materialShort) parts.push(materialShort);

  const coatingName = (item.lensCoating ?? '').trim();
  if (coatingName) parts.push(shorts.coating.get(coatingName) || coatingName);

  const lensType = (item.lensType ?? '').trim();
  if (lensType === 'Bifocal') parts.push('KT');
  else if (lensType === 'Progressive') parts.push('Progressive');

  return parts.join(' ') || (item.lensLabel ?? '').trim() || 'Lens';
}
