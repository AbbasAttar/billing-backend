import { Response } from 'express';

export const ok = <T>(res: Response, data: T, message?: string, status = 200) =>
  res.status(status).json({ success: true, data, message });

export const fail = (res: Response, message: string, status = 400) =>
  res.status(status).json({ success: false, message });
