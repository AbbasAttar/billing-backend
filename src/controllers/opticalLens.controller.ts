import { Request, Response, NextFunction } from 'express';
import { OpticalLens } from '../models/OpticalLens.model';
import { InvoiceItem } from '../models/InvoiceItem.model';

export const getAllOpticalLenses = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const lenses = await OpticalLens.find().sort({ name: 1 });
        res.json(lenses);
    } catch (error) {
        next(error);
    }
};

export const searchOpticalLenses = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const q = (req.query.q as string) || '';
        const lenses = await OpticalLens.find({
            $or: [
                { name: { $regex: q, $options: 'i' } },
                { brand: { $regex: q, $options: 'i' } },
                { category: { $regex: q, $options: 'i' } },
            ],
        }).limit(15);
        res.json(lenses);
    } catch (error) {
        next(error);
    }
};

export const getOpticalLensById = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const lens = await OpticalLens.findById(req.params.id);
        if (!lens) {
            res.status(404).json({ message: 'Optical lens not found' });
            return;
        }
        res.json(lens);
    } catch (error) {
        next(error);
    }
};

export const createOpticalLens = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const lens = new OpticalLens(req.body);
        const saved = await lens.save();
        res.status(201).json(saved);
    } catch (error) {
        next(error);
    }
};

export const updateOpticalLens = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const lens = await OpticalLens.findByIdAndUpdate(req.params.id, req.body, {
            new: true,
            runValidators: true,
        });
        if (!lens) {
            res.status(404).json({ message: 'Optical lens not found' });
            return;
        }
        res.json(lens);
    } catch (error) {
        next(error);
    }
};

export const deleteOpticalLens = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const usageCount = await InvoiceItem.countDocuments({ opticalLens: req.params.id });
        if (usageCount > 0) {
            res.status(409).json({ message: 'Optical Lens is used in existing invoices and cannot be deleted.' });
            return;
        }
        const lens = await OpticalLens.findByIdAndDelete(req.params.id);
        if (!lens) {
            res.status(404).json({ message: 'Optical lens not found' });
            return;
        }
        res.json({ message: 'Optical lens deleted' });
    } catch (error) {
        next(error);
    }
};
