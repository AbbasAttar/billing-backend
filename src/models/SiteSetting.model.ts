import { Schema, model, Document } from 'mongoose';

export interface ISiteSetting extends Document {
  key: string;
  value: any;
}

const SiteSettingSchema = new Schema<ISiteSetting>(
  {
    key: { type: String, required: true, unique: true, trim: true },
    value: { type: Schema.Types.Mixed },
  },
  { timestamps: true }
);

export const SiteSetting = model<ISiteSetting>('SiteSetting', SiteSettingSchema);
