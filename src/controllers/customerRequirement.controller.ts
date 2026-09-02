import { Request, Response, NextFunction } from 'express';
import { CustomerRequirement, RequirementStatus } from '../models/CustomerRequirement.model';
import { Customer } from '../models/Customer.model';

// GET all customer requirements with filters
export const getRequirements = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { status, category, urgency, search, limit = '100' } = req.query;

    const filter: any = {};
    if (status && status !== 'all') {
      filter.status = status;
    }
    if (category && category !== 'all') {
      filter.category = category;
    }
    if (urgency && urgency !== 'all') {
      filter.urgency = urgency;
    }
    if (search && typeof search === 'string' && search.trim()) {
      const q = search.trim();
      filter.$or = [
        { customerName: { $regex: q, $options: 'i' } },
        { customerMobile: { $regex: q, $options: 'i' } },
        { title: { $regex: q, $options: 'i' } },
        { brand: { $regex: q, $options: 'i' } },
        { modelNumber: { $regex: q, $options: 'i' } },
        { specifications: { $regex: q, $options: 'i' } },
      ];
    }

    const requirements = await CustomerRequirement.find(filter)
      .populate('customer', 'name mobileNumber mobile address city')
      .populate('convertedInvoiceId', 'invoiceNumber total billDate')
      .sort({ createdAt: -1 })
      .limit(parseInt(limit as string, 10) || 100)
      .lean();

    // Summary counts for quick badges
    const [pendingCount, orderedCount, arrivedCount, fulfilledCount] = await Promise.all([
      CustomerRequirement.countDocuments({ status: 'pending' }),
      CustomerRequirement.countDocuments({ status: 'ordered' }),
      CustomerRequirement.countDocuments({ status: 'arrived' }),
      CustomerRequirement.countDocuments({ status: 'fulfilled' }),
    ]);

    res.json({
      requirements,
      counts: {
        all: pendingCount + orderedCount + arrivedCount + fulfilledCount,
        pending: pendingCount,
        ordered: orderedCount,
        arrived: arrivedCount,
        fulfilled: fulfilledCount,
      },
    });
  } catch (error) {
    next(error);
  }
};

// GET requirement by ID
export const getRequirementById = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const reqDoc = await CustomerRequirement.findById(req.params.id)
      .populate('customer')
      .populate('convertedInvoiceId');

    if (!reqDoc) {
      res.status(404).json({ message: 'Requirement not found' });
      return;
    }
    res.json(reqDoc);
  } catch (error) {
    next(error);
  }
};

// CREATE customer requirement
export const createRequirement = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const {
      customerId,
      customerName,
      customerMobile,
      customerCity,
      category,
      title,
      brand,
      modelNumber,
      color,
      specifications,
      estimatedPrice,
      urgency,
      notes,
      vendorNotes,
      date,
    } = req.body;

    if (!title || !title.trim()) {
      res.status(400).json({ message: 'Requirement title or product name is required' });
      return;
    }
    if (!customerName || !customerName.trim()) {
      res.status(400).json({ message: 'Customer name is required' });
      return;
    }
    if (!customerMobile || !customerMobile.trim()) {
      res.status(400).json({ message: 'Customer phone number is required' });
      return;
    }

    let resolvedCustomerId = customerId;
    // Auto find or create customer if not provided
    if (!resolvedCustomerId && customerMobile) {
      const cleanMobile = customerMobile.replace(/[^0-9]/g, '').slice(-10);
      let cust = await Customer.findOne({
        $or: [{ mobileNumber: cleanMobile }, { mobile: cleanMobile }],
      });
      if (!cust && customerName.trim()) {
        cust = await Customer.create({
          name: customerName.trim(),
          mobileNumber: cleanMobile,
          address: customerCity || undefined,
        });
      }
      if (cust) resolvedCustomerId = cust._id;
    }

    const newReq = await CustomerRequirement.create({
      date: date ? new Date(date) : new Date(),
      customer: resolvedCustomerId,
      customerName: customerName.trim(),
      customerMobile: customerMobile.trim(),
      customerCity: customerCity?.trim() || undefined,
      category: category || 'frame',
      title: title.trim(),
      brand: brand?.trim() || undefined,
      modelNumber: modelNumber?.trim() || undefined,
      color: color?.trim() || undefined,
      specifications: specifications?.trim() || undefined,
      estimatedPrice: typeof estimatedPrice === 'number' ? estimatedPrice : undefined,
      urgency: urgency || 'normal',
      status: 'pending',
      notes: notes?.trim() || undefined,
      vendorNotes: vendorNotes?.trim() || undefined,
    });

    const populated = await CustomerRequirement.findById(newReq._id).populate('customer');
    res.status(201).json(populated);
  } catch (error) {
    next(error);
  }
};

// UPDATE requirement
export const updateRequirement = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { status } = req.body;
    const updates = { ...req.body };

    if (status === 'arrived' && !updates.arrivedDate) {
      updates.arrivedDate = new Date();
    } else if (status === 'fulfilled' && !updates.fulfilledDate) {
      updates.fulfilledDate = new Date();
    }

    const updated = await CustomerRequirement.findByIdAndUpdate(req.params.id, updates, {
      new: true,
      runValidators: true,
    })
      .populate('customer')
      .populate('convertedInvoiceId');

    if (!updated) {
      res.status(404).json({ message: 'Requirement not found' });
      return;
    }

    res.json(updated);
  } catch (error) {
    next(error);
  }
};

// UPDATE requirement status only
export const updateRequirementStatus = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { status, convertedInvoiceId } = req.body as {
      status: RequirementStatus;
      convertedInvoiceId?: string;
    };

    if (!status) {
      res.status(400).json({ message: 'Status is required' });
      return;
    }

    const patch: any = { status };
    if (status === 'arrived') {
      patch.arrivedDate = new Date();
    } else if (status === 'fulfilled') {
      patch.fulfilledDate = new Date();
      if (convertedInvoiceId) patch.convertedInvoiceId = convertedInvoiceId;
    }

    const updated = await CustomerRequirement.findByIdAndUpdate(req.params.id, patch, {
      new: true,
    })
      .populate('customer')
      .populate('convertedInvoiceId');

    if (!updated) {
      res.status(404).json({ message: 'Requirement not found' });
      return;
    }

    res.json(updated);
  } catch (error) {
    next(error);
  }
};

// DELETE requirement
export const deleteRequirement = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const deleted = await CustomerRequirement.findByIdAndDelete(req.params.id);
    if (!deleted) {
      res.status(404).json({ message: 'Requirement not found' });
      return;
    }
    res.json({ message: 'Requirement deleted successfully' });
  } catch (error) {
    next(error);
  }
};
