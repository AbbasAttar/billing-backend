import { Request, Response, NextFunction } from 'express';
import { Prescription } from '../models/Prescription.model';

export const getPrescriptionsByCustomer = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const prescriptions = await Prescription.find({ customer: req.params.customerId }).sort({ createdAt: -1 });
        res.json(prescriptions);
    } catch (error) {
        next(error);
    }
};

export const getPrescriptionById = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const prescription = await Prescription.findById(req.params.id).populate('customer');
        if (!prescription) {
            res.status(404).json({ message: 'Prescription not found' });
            return;
        }
        res.json(prescription);
    } catch (error) {
        next(error);
    }
};

export const createPrescription = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { customer, userName, ...rest } = req.body;
        let finalUserName = userName?.trim() || undefined;

        if (!finalUserName && customer) {
            import('../models/Customer.model').then(async ({ Customer }) => {
                const custDoc = await Customer.findById(customer);
                finalUserName = custDoc?.name || undefined;

                const prescription = new Prescription({ customer, userName: finalUserName, ...rest });
                const saved = await prescription.save();
                res.status(201).json(saved);
            }).catch(next);
            return;
        }

        const prescription = new Prescription({ customer, userName: finalUserName, ...rest });
        const saved = await prescription.save();
        res.status(201).json(saved);
    } catch (error) {
        next(error);
    }
};

export const updatePrescription = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const prescription = await Prescription.findByIdAndUpdate(req.params.id, req.body, {
            new: true,
            runValidators: true,
        });
        if (!prescription) {
            res.status(404).json({ message: 'Prescription not found' });
            return;
        }
        res.json(prescription);
    } catch (error) {
        next(error);
    }
};

export const deletePrescription = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const prescription = await Prescription.findByIdAndDelete(req.params.id);
        if (!prescription) {
            res.status(404).json({ message: 'Prescription not found' });
            return;
        }
        res.json({ message: 'Prescription deleted' });
    } catch (error) {
        next(error);
    }
};
