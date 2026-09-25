import { createFirestoreModel, BaseDoc } from '../lib/firestoreModel';

export interface ISiteSetting extends BaseDoc {
  key: string;
  value: any;
  createdAt?: Date;
  updatedAt?: Date;
}

export const SiteSetting = createFirestoreModel<ISiteSetting>('sitesettings');
