import mongoose, { Document, Schema } from 'mongoose';

export interface IObligationPayment extends Document {
  obligationId: mongoose.Types.ObjectId;
  creditor: string;
  amountPaid: number;
  date: Date;
  method?: string;
  notes?: string;
  createdAt: Date;
}

const ObligationPaymentSchema = new Schema<IObligationPayment>(
  {
    obligationId: { type: Schema.Types.ObjectId, required: true, ref: 'Obligation' },
    creditor:     { type: String, required: true, trim: true },
    amountPaid:   { type: Number, required: true, min: 0.01 },
    date:         { type: Date, required: true, default: Date.now },
    method:       { type: String, trim: true },
    notes:        { type: String, trim: true, maxlength: 500 },
  },
  { timestamps: true }
);

ObligationPaymentSchema.index({ obligationId: 1 });
ObligationPaymentSchema.index({ date: -1 });

export const ObligationPayment = mongoose.model<IObligationPayment>('ObligationPayment', ObligationPaymentSchema);
