import mongoose, { Schema, Document } from 'mongoose';

export interface IPrescription extends Document {
    customer: mongoose.Types.ObjectId;
    label: string;
    leftSpherical?: number;
    leftCylinder?: number;
    leftAddition?: number;
    leftAxis?: number;
    rightSpherical?: number;
    rightCylinder?: number;
    rightAddition?: number;
    rightAxis?: number;
    notes?: string;
}

const PrescriptionSchema = new Schema<IPrescription>(
    {
        customer: { type: Schema.Types.ObjectId, ref: 'Customer', required: true },
        label: { type: String, required: true, trim: true },
        leftSpherical: { type: Number },
        leftCylinder: { type: Number },
        leftAddition: { type: Number },
        leftAxis: { type: Number, min: 0, max: 180 },
        rightSpherical: { type: Number },
        rightCylinder: { type: Number },
        rightAddition: { type: Number },
        rightAxis: { type: Number, min: 0, max: 180 },
        notes: { type: String, trim: true },
    },
    { timestamps: true }
);

PrescriptionSchema.index({ customer: 1 });

export const Prescription = mongoose.model<IPrescription>('Prescription', PrescriptionSchema);
