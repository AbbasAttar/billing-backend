import { createFirestoreModel, BaseDoc } from '../lib/firestoreModel';

export interface ILostSale extends BaseDoc {
  date: Date;
  productDescription: string;
  category: 'frame' | 'opticalLens' | 'fragrance' | 'other';
  qty: number;
  estimatedPrice: number;
  customer?: string | any;
  notes?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export const LostSale = createFirestoreModel<ILostSale>('lostsales');
