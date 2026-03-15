import { Request, Response, NextFunction } from 'express';
import { Customer } from '../models/Customer.model';
import { Invoice } from '../models/Invoice.model';

export const getAllCustomers = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const page = parseInt(req.query.page as string) || 0;
    const limit = parseInt(req.query.limit as string) || 0;
    let query = Customer.find().sort({ name: 1 });
    if (page > 0 && limit > 0) {
      query = query.skip((page - 1) * limit).limit(limit) as typeof query;
    }
    const customers = await query;
    res.json(customers);
  } catch (error) {
    next(error);
  }
};

export const searchCustomers = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const q = (req.query.q as string) || '';
    const customers = await Customer.find({
      $or: [
        { name: { $regex: q, $options: 'i' } },
        { mobileNumber: { $regex: q, $options: 'i' } },
      ],
    }).limit(10);
    res.json(customers);
  } catch (error) {
    next(error);
  }
};

export const getCustomerById = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const customer = await Customer.findById(req.params.id);
    if (!customer) {
      res.status(404).json({ message: 'Customer not found' });
      return;
    }
    res.json(customer);
  } catch (error) {
    next(error);
  }
};

export const createCustomer = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const customer = new Customer(req.body);
    const saved = await customer.save();
    res.status(201).json(saved);
  } catch (error) {
    next(error);
  }
};

export const updateCustomer = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const customer = await Customer.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
      runValidators: true,
    });
    if (!customer) {
      res.status(404).json({ message: 'Customer not found' });
      return;
    }
    res.json(customer);
  } catch (error) {
    next(error);
  }
};

export const deleteCustomer = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const invoiceCount = await Invoice.countDocuments({ customer: req.params.id });
    if (invoiceCount > 0) {
      res.status(409).json({ message: 'Customer has existing invoices and cannot be deleted.' });
      return;
    }
    const customer = await Customer.findByIdAndDelete(req.params.id);
    if (!customer) {
      res.status(404).json({ message: 'Customer not found' });
      return;
    }
    res.json({ message: 'Customer deleted' });
  } catch (error) {
    next(error);
  }
};
