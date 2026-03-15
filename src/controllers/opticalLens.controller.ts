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

export const getBrands = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const brands = await OpticalLens.distinct('brand');
        res.json(brands.sort());
    } catch (error) {
        next(error);
    }
};

export const searchOpticalLenses = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const q = (req.query.q as string) || '';
        const brand = (req.query.brand as string);
        const name = (req.query.name as string);

        const filter: any = {};

        if (brand && name) {
            filter.brand = { $regex: new RegExp(`^${brand}$`, 'i') };
            filter.name = { $regex: new RegExp(`^${name}$`, 'i') };
        } else if (q) {
            filter.$or = [
                { name: { $regex: q, $options: 'i' } },
                { brand: { $regex: q, $options: 'i' } },
                { category: { $regex: q, $options: 'i' } },
            ];
        }

        const lenses = await OpticalLens.find(filter).limit(15);
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
