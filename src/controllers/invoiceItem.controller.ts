import { Request, Response, NextFunction } from 'express';
import { InvoiceItem } from '../models/InvoiceItem.model';

export const getAllInvoiceItems = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const items = await InvoiceItem.find()
      .populate('frame')
      .populate('opticalLens')
      .populate('fragrance');
    res.json(items);
  } catch (error) {
    next(error);
  }
};

export const getInvoiceItemById = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const item = await InvoiceItem.findById(req.params.id)
      .populate('frame')
      .populate('opticalLens')
      .populate('fragrance');
    if (!item) {
      res.status(404).json({ message: 'Invoice item not found' });
      return;
    }
    res.json(item);
  } catch (error) {
    next(error);
  }
};

export const createInvoiceItem = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const item = new InvoiceItem(req.body);
    const saved = await item.save();
    res.status(201).json(saved);
  } catch (error) {
    next(error);
  }
};

export const updateInvoiceItem = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const item = await InvoiceItem.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
      runValidators: true,
    });
    if (!item) {
      res.status(404).json({ message: 'Invoice item not found' });
      return;
    }
    res.json(item);
  } catch (error) {
    next(error);
  }
};

export const deleteInvoiceItem = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const item = await InvoiceItem.findByIdAndDelete(req.params.id);
    if (!item) {
      res.status(404).json({ message: 'Invoice item not found' });
      return;
    }
    res.json({ message: 'Invoice item deleted' });
  } catch (error) {
    next(error);
  }
};
