import { createFirestoreModel, BaseDoc } from '../lib/firestoreModel';

/** Master list of companies for wholesale items, so one company is spelled the same everywhere. */
export interface IWholesaleCompany extends BaseDoc {
  name: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export const WholesaleCompany = createFirestoreModel<IWholesaleCompany>('wholesalecompanies', { mirror: true });
