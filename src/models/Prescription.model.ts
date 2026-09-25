import { createFirestoreModel, BaseDoc } from '../lib/firestoreModel';

export interface IPrescription extends BaseDoc {
  customer: string | any;
  label: string;
  userName?: string;
  leftSpherical?: number;
  leftCylinder?: number;
  leftAddition?: number;
  leftAxis?: number;
  rightSpherical?: number;
  rightCylinder?: number;
  rightAddition?: number;
  rightAxis?: number;
  notes?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export const Prescription = createFirestoreModel<IPrescription>('prescriptions');
