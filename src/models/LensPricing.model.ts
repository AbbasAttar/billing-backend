import { createFirestoreModel, BaseDoc } from '../lib/firestoreModel';

export const LENS_TYPES     = ['Single Vision', 'Bifocal', 'Progressive'] as const;
export const LENS_MATERIALS = ['Polycarbonate', 'Fiber', 'Glass'] as const;
export const LENS_COLORS    = ['White', 'Photo Chromatic', 'Polarized', 'Tinted'] as const;
export const AXIS_TYPES     = ['any', 'ready', 'cross'] as const;

export type LensType     = typeof LENS_TYPES[number];
export type LensMaterial = typeof LENS_MATERIALS[number];
export type LensColor    = typeof LENS_COLORS[number];
export type AxisType     = typeof AXIS_TYPES[number];

export interface ILensPricing extends BaseDoc {
  lensType:  LensType;
  material:  LensMaterial;
  coating:   string;
  color:     LensColor;
  axisType:  AxisType;   // 'ready' | 'cross' | 'any'
  minSph:    number;
  maxSph:    number;
  minCyl:    number;
  maxCyl:    number;
  minAdd:    number | null;
  maxAdd:    number | null;
  price:     number;
  costPrice: number;
  wholesaler?: string;
  brand?:      string;
  features?:   string[];
  mrp?:        number;
  effectiveDate?: string;
  dia?:        string;
  createdAt?: Date;
  updatedAt?: Date;
}

export const LensPricing = createFirestoreModel<ILensPricing>('lenspricings');
