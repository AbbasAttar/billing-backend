import { Request, Response, NextFunction } from 'express';
import { VendorBill } from '../models/VendorBill.model';
import { Expense } from '../models/Expense.model';
import { Invoice } from '../models/Invoice.model';
import { ok, created, fail } from '../utils/response';

const parseDate = (value?: string) => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

export const createBill = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const bill = new VendorBill(req.body);
    await bill.save();
    return created(res, bill);
  } catch (error) {
    next(error);
  }
};

export const updateBill = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { vendorName, billDate, dueDate, totalAmount, category, note, items } = req.body as {
      vendorName?: string;
      billDate?: string;
      dueDate?: string;
      totalAmount?: number;
      category?: string;
      note?: string;
      items?: { description: string; amount: number }[];
    };

    if (!vendorName?.trim()) return fail(res, 'vendorName is required', 400);
    if (typeof totalAmount !== 'number' || totalAmount <= 0) return fail(res, 'totalAmount must be greater than 0', 400);
    if (!category?.trim()) return fail(res, 'category is required', 400);

    const parsedBillDate = parseDate(billDate) || new Date();
    const parsedDueDate = parseDate(dueDate);

    const bill = await VendorBill.findById(req.params.id);
    if (!bill) return fail(res, 'Bill not found', 404);
    if (bill.paidAmount > totalAmount) {
      return fail(res, 'totalAmount cannot be lower than amount already paid', 400);
    }

    bill.vendorName = vendorName.trim();
    bill.billDate = parsedBillDate;
    if (parsedDueDate) {
      bill.dueDate = parsedDueDate;
    }
    bill.totalAmount = totalAmount;
    bill.category = category.trim();
    bill.note = note;
    bill.items =
      items?.filter((item) => item.description?.trim() && typeof item.amount === 'number' && item.amount >= 0)
        .map((item) => ({ description: item.description.trim(), amount: item.amount })) ?? [];

    await bill.save();
    return ok(res, bill, 'Bill updated');
  } catch (error) {
    next(error);
  }
};

export const getBills = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { status, vendorName } = req.query;
    const filter: any = {};
    if (status) filter.status = status;
    if (vendorName) filter.vendorName = { $regex: vendorName, $options: 'i' };

    const bills = await VendorBill.find(filter).sort({ billDate: -1, createdAt: -1 });
    return ok(res, bills);
  } catch (error) {
    next(error);
  }
};

export const getBillById = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const bill = await VendorBill.findById(req.params.id);
    if (!bill) return res.status(404).json({ message: 'Bill not found' });
    return ok(res, bill);
  } catch (error) {
    next(error);
  }
};

export const addPayment = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { amount, method, date, note, recordExpense } = req.body;
    if (typeof amount !== 'number' || amount <= 0) {
      return fail(res, 'amount must be greater than 0', 400);
    }

    const bill = await VendorBill.findById(req.params.id);
    if (!bill) return res.status(404).json({ message: 'Bill not found' });

    const paymentDate = date ? new Date(date) : new Date();
    const paymentMethod = method === 'upi' || method === 'card' || method === 'bank_transfer' ? method : 'cash';

    bill.payments.push({ amount, method: paymentMethod, date: paymentDate, note });
    bill.paidAmount += amount;
    await bill.save();

    // Optionally record in Store Expenses ledger for counter outflow tracking
    let createdExpense = null;
    if (recordExpense !== false) {
      createdExpense = await Expense.create({
        date: paymentDate,
        amount,
        category: 'stock',
        paymentMethod: paymentMethod,
        vendorName: bill.vendorName,
        note: note || `Vendor payout to ${bill.vendorName}`,
      });
    }

    return ok(res, { bill, expense: createdExpense }, 'Payment recorded successfully');
  } catch (error) {
    next(error);
  }
};

export const deletePayment = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const rawId = req.params.id;
    const rawIndex = req.params.paymentIndex;
    const id = Array.isArray(rawId) ? rawId[0] : rawId;
    const paymentIndex = Array.isArray(rawIndex) ? rawIndex[0] : rawIndex;

    const idx = parseInt(paymentIndex, 10);
    if (isNaN(idx) || idx < 0) {
      return fail(res, 'Invalid payment index', 400);
    }

    const bill = await VendorBill.findById(id);
    if (!bill) return fail(res, 'Bill not found', 404);

    if (!bill.payments || idx >= bill.payments.length) {
      return fail(res, 'Payment record not found', 404);
    }

    const [removedPayment] = bill.payments.splice(idx, 1);
    bill.paidAmount = Math.max(0, bill.paidAmount - (removedPayment?.amount || 0));
    await bill.save();

    return ok(res, bill, 'Payment removed successfully');
  } catch (error) {
    next(error);
  }
};

export const deleteBill = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const bill = await VendorBill.findByIdAndDelete(req.params.id);
    if (!bill) return fail(res, 'Bill not found', 404);

    return ok(res, { _id: bill._id }, 'Bill deleted');
  } catch (error) {
    next(error);
  }
};

export const getAISuggestion = async (_req: Request, res: Response, next: NextFunction) => {
  try {
    // 1. Get Revenue Trends (Last 30 days)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const revenueData = await Invoice.aggregate([
      { $unwind: '$payments' },
      { $match: { 'payments.date': { $gte: thirtyDaysAgo } } },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$payments.date' } },
          amount: { $sum: '$payments.amount' },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    const totalRevenue = revenueData.reduce((sum, d) => sum + d.amount, 0);
    const avgDailyRevenue = totalRevenue / 30;

    // 2. Get Pending Bills
    const pendingBills = await VendorBill.find({ status: { $ne: 'paid' } }).sort({ dueDate: 1 });

    const totalPendingAmount = pendingBills.reduce((sum, b) => sum + (b.totalAmount - b.paidAmount), 0);

    // 3. Payout suggestion allocation
    const dailyAllocation = avgDailyRevenue * 0.4;
    
    let remainingAllocation = dailyAllocation * 7;
    const suggestions = [];
    
    for (const bill of pendingBills) {
      const balance = bill.totalAmount - bill.paidAmount;
      if (remainingAllocation <= 0) break;
      
      const payment = Math.min(balance, remainingAllocation);
      if (payment > 0) {
        suggestions.push({
          billId: bill._id,
          vendorName: bill.vendorName,
          dueDate: bill.dueDate,
          totalAmount: bill.totalAmount,
          balance,
          suggestedPayment: payment,
          priority: (bill.dueDate && bill.dueDate < new Date()) ? 'CRITICAL (Overdue)' : (bill.dueDate && (bill.dueDate.getTime() - Date.now() < 86400000 * 3) ? 'HIGH' : 'MEDIUM'),
        });
        remainingAllocation -= payment;
      }
    }

    return ok(res, {
      summary: {
        avgDailyRevenue,
        weeklyBillBudget: dailyAllocation * 7,
        totalPendingAmount,
      },
      suggestions,
      insight: `Based on your average daily revenue of ₹${avgDailyRevenue.toFixed(2)}, you can safely allocate ₹${(dailyAllocation * 7).toFixed(2)} per week towards clearing pending bills. Prioritizing overdue and near-deadline bills.`,
    });
  } catch (error) {
    next(error);
  }
};
