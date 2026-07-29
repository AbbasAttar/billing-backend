import mongoose, { Document, Schema } from 'mongoose';
import bcrypt from 'bcryptjs';

export interface IUser extends Document {
  name:             string;
  phone:            string;
  passwordHash:     string;
  phoneVerified:    boolean;
  email?:           string;
  emailVerified:    boolean;
  reauthToken?:     string;
  reauthExpiry?:    Date;
  address?:         string;
  avatarB64?:       string;
  createdAt:        Date;
  updatedAt:        Date;
  comparePassword(password: string): Promise<boolean>;
}

const userSchema = new Schema<IUser>(
  {
    name:            { type: String, required: true, trim: true },
    phone:           { type: String, required: true, unique: true, index: true },
    passwordHash:    { type: String, required: true },
    phoneVerified:   { type: Boolean, default: false },
    email:           { type: String, trim: true },
    emailVerified:   { type: Boolean, default: false },
    reauthToken:     { type: String },
    reauthExpiry:    { type: Date },
    address:         { type: String, trim: true },
    avatarB64:       { type: String },
  },
  { timestamps: true },
);

userSchema.methods.comparePassword = function (password: string) {
  return bcrypt.compare(password, this.passwordHash);
};

export const User = mongoose.model<IUser>('User', userSchema);
