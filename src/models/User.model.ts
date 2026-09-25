import { createFirestoreModel, BaseDoc } from '../lib/firestoreModel';
import bcrypt from 'bcryptjs';

export interface IUser extends BaseDoc {
  name: string;
  phone: string;
  passwordHash: string;
  phoneVerified: boolean;
  email?: string;
  emailVerified: boolean;
  reauthToken?: string;
  reauthExpiry?: Date;
  address?: string;
  city?: string;
  state?: string;
  pincode?: string;
  avatarB64?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

const baseUserModel = createFirestoreModel<IUser>('users');

export const User = {
  ...baseUserModel,
  async comparePassword(user: IUser, password: string): Promise<boolean> {
    if (!user || !user.passwordHash) return false;
    return bcrypt.compare(password, user.passwordHash);
  },
};
