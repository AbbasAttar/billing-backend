import { createFirestoreModel, BaseDoc } from '../lib/firestoreModel';

export interface ICoating extends BaseDoc {
  name: string;
  shortName?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export const Coating = createFirestoreModel<ICoating>('coatings');
