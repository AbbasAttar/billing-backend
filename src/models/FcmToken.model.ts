import { createFirestoreModel, BaseDoc } from '../lib/firestoreModel';

export interface IFcmToken extends BaseDoc {
  token: string;
  registeredAt: Date;
  createdAt?: Date;
  updatedAt?: Date;
}

export const FcmToken = createFirestoreModel<IFcmToken>('fcmtokens');
