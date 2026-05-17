import { Request, Response, NextFunction } from 'express';

export const validateRequest = (requiredFields: string[]) => {
  return (req: Request, res: Response, next: NextFunction) => {
    const missing = requiredFields.filter((field) => {
      const value = req.body[field];
      return value === undefined || value === null || value === '';
    });

    if (missing.length > 0) {
      res.status(400).json({
        message: `Missing required fields: ${missing.join(', ')}`,
      });
      return;
    }

    next();
  };
};
