import mongoose, { Schema, Document } from 'mongoose';

interface IFcmToken extends Document {
  token: string;
  registeredAt: Date;
}

const FcmTokenSchema = new Schema<IFcmToken>({
  token:          { type: String, required: true, unique: true },
  registeredAt:   { type: Date, default: Date.now },
});

export const FcmToken = mongoose.model<IFcmToken>('FcmToken', FcmTokenSchema);
