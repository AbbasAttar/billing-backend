import mongoose, { Document, Schema } from 'mongoose';

export interface ICommitment extends Document {
  name: string;
  amount: number;
  dueDay?: number;
  isEssential: boolean;
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
}

const CommitmentSchema = new Schema<ICommitment>(
  {
    name: { type: String, required: true, trim: true },
    amount: { type: Number, required: true, min: 0 },
    dueDay: { type: Number, min: 1, max: 31 },
    isEssential: { type: Boolean, default: true },
    notes: { type: String, trim: true, maxlength: 500 },
  },
  { timestamps: true }
);

export const Commitment = mongoose.model<ICommitment>('Commitment', CommitmentSchema);
