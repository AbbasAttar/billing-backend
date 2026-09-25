import { createFirestoreModel, BaseDoc } from '../lib/firestoreModel';

export interface IFrameStock extends BaseDoc {
  frameCode: string;
  companyCode: string;
  companyName: string;
  costPrice: number;
  sellPrice: number;
  purchaseMonth: number;
  purchaseYear: number;
  quantity: number;
  reorderLevel: number;
  createdAt?: Date;
  updatedAt?: Date;
}

export const FrameStock = createFirestoreModel<IFrameStock>('framestocks');
