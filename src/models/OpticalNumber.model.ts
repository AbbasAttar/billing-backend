import { createFirestoreModel, BaseDoc } from '../lib/firestoreModel';

export interface IOpticalNumber extends BaseDoc {
  customer: string | any;
  name: string;
  leftSpherical?: number;
  leftCylinder?: number;
  leftAddition?: number;
  leftAxis?: number;
  rightSpherical?: number;
  rightCylinder?: number;
  rightAddition?: number;
  rightAxis?: number;
  lensType?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export const OpticalNumber = createFirestoreModel<IOpticalNumber>('opticalnumbers');
