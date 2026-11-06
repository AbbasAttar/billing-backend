import { createFirestoreModel, BaseDoc } from '../lib/firestoreModel';
import type { BrandAlias } from '../services/lensAliases';

export interface ICoating extends BaseDoc {
  name: string;
  shortName?: string;
  /** The same coating under each company's own name, e.g. Crizal "Rock", Dioptres "Tuff". */
  aliases?: BrandAlias[];
  createdAt?: Date;
  updatedAt?: Date;
}

export const Coating = createFirestoreModel<ICoating>('coatings', { mirror: true });
