import { Request, Response, NextFunction } from 'express';
import { OpticalNumber } from '../models/OpticalNumber.model';

export const getAllOpticalNumbers = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const items = await OpticalNumber.find().populate('customer', 'name');
    res.json(items);
  } catch (error) {
    next(error);
  }
};

export const getByCustomer = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const items = await OpticalNumber.find({ customer: req.params.customerId });
    res.json(items);
  } catch (error) {
    next(error);
  }
};

export const getOpticalNumberById = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const item = await OpticalNumber.findById(req.params.id).populate('customer', 'name');
    if (!item) {
      res.status(404).json({ message: 'Prescription not found' });
      return;
    }
    res.json(item);
  } catch (error) {
    next(error);
  }
};

export const createOpticalNumber = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const item = new OpticalNumber(req.body);
    const saved = await item.save();
    res.status(201).json(saved);
  } catch (error) {
    next(error);
  }
};

export const updateOpticalNumber = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const item = await OpticalNumber.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
      runValidators: true,
    });
    if (!item) {
      res.status(404).json({ message: 'Prescription not found' });
      return;
    }
    res.json(item);
  } catch (error) {
    next(error);
  }
};

export const deleteOpticalNumber = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const item = await OpticalNumber.findByIdAndDelete(req.params.id);
    if (!item) {
      res.status(404).json({ message: 'Prescription not found' });
      return;
    }
    res.json({ message: 'Prescription deleted' });
  } catch (error) {
    next(error);
  }
};
