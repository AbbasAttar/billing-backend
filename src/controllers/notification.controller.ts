import { Request, Response, NextFunction } from 'express';
import { FcmToken } from '../models/FcmToken.model';

export const registerFcmToken = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { token } = req.body as { token?: string };
    if (!token?.trim()) { res.status(400).json({ message: 'token is required' }); return; }
    await FcmToken.updateOne({ token }, { token, registeredAt: new Date() }, { upsert: true });
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
};

export const unregisterFcmToken = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { token } = req.body as { token?: string };
    if (!token?.trim()) { res.status(400).json({ message: 'token is required' }); return; }
    await FcmToken.deleteOne({ token });
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
};
