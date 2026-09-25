import { createFirestoreModel, BaseDoc } from '../lib/firestoreModel';

export interface IFrameCompany extends BaseDoc {
  code: string; // e.g. "01"
  name: string; // e.g. "Tulsi"
  createdAt?: Date;
  updatedAt?: Date;
}

export const FrameCompany = createFirestoreModel<IFrameCompany>('framecompanies');
