import { createFirestoreModel, BaseDoc } from '../lib/firestoreModel';

export interface IFrameColor extends BaseDoc {
  name: string;
  hex: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export const FrameColor = createFirestoreModel<IFrameColor>('framecolors');
