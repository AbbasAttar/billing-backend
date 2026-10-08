import { Request, Response, NextFunction } from 'express';
import { isProduction } from '../config/env';

export interface AppError extends Error {
  statusCode?: number;
}

export const errorHandler = (
  err: AppError,
  req: Request,
  res: Response,
  next: NextFunction
) => {
  console.error('❌ Error:', err.message);

  const statusCode = err.statusCode || 500;
  res.status(statusCode).json({
    message: err.message || 'Internal Server Error',
    ...(!isProduction() && { stack: err.stack }),
  });
};
