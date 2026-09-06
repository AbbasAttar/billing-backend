import { GoogleGenAI, Type, FunctionDeclaration } from '@google/genai';
import { env } from '../config/env';
import { Invoice } from '../models/Invoice.model';
import { Customer } from '../models/Customer.model';
import { Frame } from '../models/Frame.model';
import { Fragrance } from '../models/Fragrance.model';
import { OpticalLens } from '../models/OpticalLens.model';
import { Expense } from '../models/Expense.model';
import { VendorBill } from '../models/VendorBill.model';
import { Obligation } from '../models/Obligation.model';
import { buildDashboardCommandCenter } from './dashboardIntelligence';

const MODEL_NAME = env.GEMINI_MODEL || 'gemini-3.6-flash';

// Tool Declarations for Gemini Function Calling
const toolDeclarations: FunctionDeclaration[] = [
  {
    name: 'get_executive_overview',
    description: 'Fetches high-level executive store metrics: current month revenue, collections, operating margin, total outstanding customer receivables, customer count, and top actionable alerts for Attarwala Optical House.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        timeframe: {
          type: Type.STRING,
          description: 'Timeframe for analysis: "month", "quarter", "year", or "allTime"',
        },
      },
    },
  },
  {
    name: 'query_sales_and_invoices',
    description: 'Queries live customer invoices and sales data. Allows filtering by date range, payment status (paid, partial, unpaid), customer name search, or sorting by highest value.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        status: {
          type: Type.STRING,
          description: 'Payment status filter: "all", "paid", "partial", or "unpaid"',
        },
        daysBack: {
          type: Type.INTEGER,
          description: 'Number of past days to query (e.g. 7 for last week, 30 for last month, 90 for quarter, 365 for year). Defaults to 30.',
        },
        minAmount: {
          type: Type.NUMBER,
          description: 'Minimum invoice total in INR to filter for high-ticket orders',
        },
        customerSearch: {
          type: Type.STRING,
          description: 'Search string to filter by customer name',
        },
        limit: {
          type: Type.INTEGER,
          description: 'Maximum number of invoice records to return (defaults to 10)',
        },
      },
    },
  },
  {
    name: 'query_customer_intelligence',
    description: 'Searches customer records, VIP spenders, customers with overdue/due balances, and purchase frequencies.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        filterType: {
          type: Type.STRING,
          description: 'Type of query: "topSpenders", "overdueBalance", "recentNew", "search"',
        },
        searchQuery: {
          type: Type.STRING,
          description: 'Name or mobile number to search for specific customer',
        },
        limit: {
          type: Type.INTEGER,
          description: 'Max records to return (default 10)',
        },
      },
    },
  },
  {
    name: 'query_inventory_stock',
    description: 'Checks inventory stock levels across frames, optical lenses, and luxury fragrances. Supports brand search (e.g. Ray-Ban, IDEE, Cartier, Vogue), low-stock alerts, and category summaries.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        category: {
          type: Type.STRING,
          description: 'Category to search: "all", "frames", "lenses", "fragrances"',
        },
        brandSearch: {
          type: Type.STRING,
          description: 'Search by brand or company name (e.g. "Ray-Ban", "IDEE", "Cartier", "Vogue")',
        },
        lowStockOnly: {
          type: Type.BOOLEAN,
          description: 'If true, returns items with stock <= 3 units',
        },
        limit: {
          type: Type.INTEGER,
          description: 'Max records to return (default 15)',
        },
      },
    },
  },
  {
    name: 'query_cashflow_and_payables',
    description: 'Queries cash flow projections, vendor bills due, upcoming debt/obligations, and store operational expense breakdowns.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        focus: {
          type: Type.STRING,
          description: 'Focus area: "summary", "vendorPayables", "upcomingObligations", "expenses"',
        },
      },
    },
  },
];

// Tool Execution Handlers
async function executeToolCall(name: string, args: any): Promise<any> {
  try {
    switch (name) {
      case 'get_executive_overview': {
        const intel = await buildDashboardCommandCenter(new Date());
        return {
          overviewKpis: intel.overview.kpis,
          financialSummary: intel.financialIntelligence.summary,
          customerSummary: intel.customerIntelligence.summary,
          actionCounts: intel.overview.actionCounts,
          actionQueue: intel.actionQueue,
          keyInsights: intel.insights?.slice(0, 4) || [],
        };
      }

      case 'query_sales_and_invoices': {
        const days = args.daysBack || 30;
        const sinceDate = new Date();
        sinceDate.setDate(sinceDate.getDate() - days);

        const query: any = { billDate: { $gte: sinceDate } };
        if (args.minAmount) {
          query.total = { $gte: Number(args.minAmount) };
        }

        const invoices = await Invoice.find(query)
          .populate('customer', 'name mobileNumber')
          .sort({ billDate: -1 })
          .limit(args.limit || 15)
          .lean();

        let filtered = invoices;
        if (args.status && args.status !== 'all') {
          filtered = invoices.filter((inv: any) => {
            const paid = (inv.payments || []).reduce((acc: number, p: any) => acc + (Number(p.amount) || 0), 0);
            const balance = Math.max((Number(inv.total) || 0) - paid, 0);
            if (args.status === 'paid') return balance <= 0;
            if (args.status === 'unpaid') return paid === 0;
            if (args.status === 'partial') return paid > 0 && balance > 0;
            return true;
          });
        }

        const totalRevenue = invoices.reduce((s: number, i: any) => s + (Number(i.total) || 0), 0);
        const totalPaid = invoices.reduce((s: number, i: any) => {
          const paid = (i.payments || []).reduce((acc: number, p: any) => acc + (Number(p.amount) || 0), 0);
          return s + paid;
        }, 0);

        return {
          count: filtered.length,
          totalPeriodRevenue: totalRevenue,
          totalPeriodCollected: totalPaid,
          outstandingPeriodBalance: Math.max(totalRevenue - totalPaid, 0),
          invoices: filtered.map((inv: any) => {
            const paid = (inv.payments || []).reduce((acc: number, p: any) => acc + (Number(p.amount) || 0), 0);
            return {
              id: inv._id,
              invoiceNumber: inv.invoiceNumber || 'N/A',
              customerName: inv.customer?.name || 'Walk-in',
              customerPhone: inv.customer?.mobileNumber || '',
              total: inv.total,
              paid,
              balance: Math.max(inv.total - paid, 0),
              billDate: inv.billDate,
            };
          }),
        };
      }

      case 'query_customer_intelligence': {
        if (args.filterType === 'search' && args.searchQuery) {
          const regex = new RegExp(args.searchQuery, 'i');
          const customers = await Customer.find({
            $or: [{ name: regex }, { mobileNumber: regex }, { tags: regex }],
          })
            .limit(args.limit || 10)
            .lean();
          return { customers };
        }

        // Aggregate customer spend and balance from Invoices
        const customerAgg = await Invoice.aggregate([
          {
            $group: {
              _id: '$customer',
              totalSpent: { $sum: '$total' },
              invoiceCount: { $sum: 1 },
              lastPurchaseDate: { $max: '$billDate' },
              totalPayments: { $sum: { $sum: '$payments.amount' } },
            },
          },
          {
            $project: {
              customerId: '$_id',
              totalSpent: 1,
              invoiceCount: 1,
              lastPurchaseDate: 1,
              balance: { $max: [0, { $subtract: ['$totalSpent', '$totalPayments'] }] },
            },
          },
          {
            $sort: args.filterType === 'overdueBalance' ? { balance: -1 } : { totalSpent: -1 },
          },
          { $limit: args.limit || 10 },
          {
            $lookup: {
              from: 'customers',
              localField: 'customerId',
              foreignField: '_id',
              as: 'customerDetails',
            },
          },
          { $unwind: { path: '$customerDetails', preserveNullAndEmptyArrays: true } },
        ]);

        return {
          type: args.filterType || 'topSpenders',
          customers: customerAgg.map((c: any) => ({
            id: c.customerId,
            name: c.customerDetails?.name || 'Customer',
            mobile: c.customerDetails?.mobileNumber || '',
            totalSpent: c.totalSpent,
            dueBalance: c.balance,
            invoiceCount: c.invoiceCount,
            lastVisit: c.lastPurchaseDate,
          })),
        };
      }

      case 'query_inventory_stock': {
        const results: any = {};
        const lowStockThreshold = args.lowStockOnly ? 3 : 99999;
        const brandRegex = args.brandSearch ? new RegExp(args.brandSearch, 'i') : null;

        if (!args.category || args.category === 'all' || args.category === 'frames') {
          const query: any = { isArchived: { $ne: true } };
          if (args.lowStockOnly) query.stock = { $lte: 3 };
          if (brandRegex) query.$or = [{ companyName: brandRegex }, { name: brandRegex }];

          results.frames = await Frame.find(query)
            .select('name companyName stock costPrice sellPrice mrp tier')
            .sort({ stock: 1 })
            .limit(args.limit || 10)
            .lean();
        }

        if (!args.category || args.category === 'all' || args.category === 'fragrances') {
          const query: any = { isArchived: { $ne: true } };
          if (args.lowStockOnly) query.stock = { $lte: 3 };
          if (brandRegex) query.$or = [{ companyName: brandRegex }, { name: brandRegex }];

          results.fragrances = await Fragrance.find(query)
            .select('name companyName stock costPrice sellPrice size tier')
            .sort({ stock: 1 })
            .limit(args.limit || 10)
            .lean();
        }

        if (!args.category || args.category === 'all' || args.category === 'lenses') {
          const query: any = { isArchived: { $ne: true } };
          if (args.lowStockOnly) query.stock = { $lte: 3 };
          if (brandRegex) query.$or = [{ brand: brandRegex }, { name: brandRegex }];

          results.opticalLenses = await OpticalLens.find(query)
            .select('name brand stock costPrice sellPrice lensType')
            .sort({ stock: 1 })
            .limit(args.limit || 10)
            .lean();
        }

        return results;
      }

      case 'query_cashflow_and_payables': {
        const vendorBills = await VendorBill.find({ status: { $in: ['pending', 'partially_paid'] } })
          .sort({ dueDate: 1 })
          .limit(8)
          .lean();

        const obligations = await Obligation.find({ isPaid: { $ne: true } })
          .sort({ dueDate: 1 })
          .limit(8)
          .lean();

        const recentExpenses = await Expense.find()
          .sort({ date: -1 })
          .limit(6)
          .lean();

        const totalPendingVendorBills = vendorBills.reduce((s: number, b: any) => s + (Number(b.balanceAmount || b.totalAmount) || 0), 0);
        const totalPendingObligations = obligations.reduce((s: number, o: any) => s + (Number(o.amount) || 0), 0);

        return {
          totalPendingVendorBills,
          totalPendingObligations,
          upcomingVendorBills: vendorBills.map((b: any) => ({
            vendorName: b.vendorName,
            invoiceNumber: b.invoiceNumber,
            totalAmount: b.totalAmount,
            balance: b.balanceAmount || b.totalAmount,
            dueDate: b.dueDate,
          })),
          upcomingObligations: obligations.map((o: any) => ({
            title: o.title || o.name,
            amount: o.amount,
            dueDate: o.dueDate,
            type: o.type,
          })),
          recentExpenses: recentExpenses.map((e: any) => ({
            title: e.title || e.category,
            amount: e.amount,
            category: e.category,
            date: e.date,
          })),
        };
      }

      default:
        return { error: `Tool ${name} not recognized` };
    }
  } catch (err: any) {
    return { error: `Tool execution failed: ${err.message}` };
  }
}

const SYSTEM_INSTRUCTION = `You are the Executive AI Operational & Data Analyst Copilot for Attarwala Optical House (AOH), established in 1959 in Dahod, Gujarat. 
AOH operates a hybrid luxury boutique selling premium eyeglass frames, precision prescription optical lenses, and luxury niche fragrances.

Your responsibility is to answer operational, financial, inventory, and customer intelligence questions with 100% accuracy by querying live MongoDB database tools.

CORE GUIDELINES:
1. ALWAYS use the provided function calling tools to look up real numbers before answering. Do not estimate or make up invoice numbers, stock quantities, or financial metrics.
2. Format currency in Indian Rupees (₹) with appropriate Indian numbering (e.g., ₹1,45,000 or ₹18.5 Lakhs).
3. Present answers in clean, executive-ready GitHub Markdown:
   - Use structured tables for lists of customers, invoices, or inventory items.
   - Use bold highlights for key KPIs.
   - Provide brief, high-leverage strategic takeaways (e.g. margin opportunities, collection follow-ups, low stock reorders).
4. If the user asks general strategic questions (like reaching ₹1 Cr target, luxury pricing, or marketing strategy), ground your advice in their actual numbers and inventory velocity.
5. Keep tone professional, authoritative, warm, and concise.`;

export interface ChatMessage {
  role: 'user' | 'model' | 'assistant' | 'system';
  content: string;
}

export interface DataChatResponse {
  answer: string;
  toolsUsed: string[];
  executionTimeMs: number;
}

export async function askGeminiDataChat(
  messages: ChatMessage[],
  latestPrompt: string
): Promise<DataChatResponse> {
  const startTime = Date.now();
  const toolsUsed: string[] = [];

  const apiKey = env.GEMINI_API_KEY;

  if (!apiKey) {
    // If no API key configured, provide real-time dashboard summary fallback with setup hint
    const intel = await buildDashboardCommandCenter(new Date());
    const sum = intel.financialIntelligence.summary;
    return {
      answer: `### ⚠️ Gemini API Key Configuration\n\nTo enable conversational AI queries via Google Gemini, please set \`GEMINI_API_KEY=your_key_here\` in \`billing-backend/.env\`.\n\nHere is your real-time store snapshot from our live analytics engine:\n\n- **Month Revenue:** ₹${sum.revenue.toLocaleString('en-IN')}\n- **Collections:** ₹${sum.collections.toLocaleString('en-IN')} (${sum.collectionEfficiency}% efficiency)\n- **Operating Margin:** ${sum.operatingMargin}%\n- **Outstanding Customer Due:** ₹${sum.outstandingReceivables.toLocaleString('en-IN')}\n- **Net Cash Position:** ₹${sum.netCashPosition.toLocaleString('en-IN')}`,
      toolsUsed: ['fallback_analytics'],
      executionTimeMs: Date.now() - startTime,
    };
  }

  const ai = new GoogleGenAI({ apiKey });

  // Format message history
  const contents: any[] = [];
  for (const m of messages.slice(-8)) {
    contents.push({
      role: m.role === 'assistant' || m.role === 'model' ? 'model' : 'user',
      parts: [{ text: m.content }],
    });
  }

  // Append latest user message
  contents.push({
    role: 'user',
    parts: [{ text: latestPrompt }],
  });

  try {
    let currentIteration = 0;
    const maxIterations = 5;

    while (currentIteration < maxIterations) {
      currentIteration++;

      let response: any;
      let attempts = 0;
      const maxAttempts = 3;

      while (attempts < maxAttempts) {
        try {
          attempts++;
          response = await ai.models.generateContent({
            model: MODEL_NAME,
            contents,
            config: {
              systemInstruction: SYSTEM_INSTRUCTION,
              tools: [{ functionDeclarations: toolDeclarations }],
              temperature: 0.2,
            },
          });
          break;
        } catch (err: any) {
          const isRateLimitOrBusy = err.status === 429 || err.status === 503 || err.message?.includes('429') || err.message?.includes('503');
          if (isRateLimitOrBusy && attempts < maxAttempts) {
            // Check if retryDelay was specified in error details or default to progressive backoff
            const retryDelayMatch = err.message?.match(/retry in ([0-9.]+)s/i);
            const parsedSeconds = retryDelayMatch ? parseFloat(retryDelayMatch[1]) : 0;
            const waitTime = Math.max(parsedSeconds * 1000 + 500, attempts * 3000);
            console.warn(`[GeminiChat] Rate limit / High demand encountered. Retrying in ${Math.round(waitTime)}ms (attempt ${attempts}/${maxAttempts})...`);
            await new Promise((r) => setTimeout(r, waitTime));
          } else {
            throw err;
          }
        }
      }
      const functionCalls = response.functionCalls;

      if (!functionCalls || functionCalls.length === 0) {
        // Final response received
        const text = response.text || 'No response generated.';
        console.log(`[GeminiChat] Completed with final text response (${text.length} chars)`);
        return {
          answer: text,
          toolsUsed,
          executionTimeMs: Date.now() - startTime,
        };
      }

      console.log(`[GeminiChat] Iteration ${currentIteration}: Model requested ${functionCalls.length} function call(s):`, functionCalls.map((f: any) => f.name));

      // Add model turn with function calls to history (preserving thought signatures)
      if (response.candidates?.[0]?.content) {
        contents.push(response.candidates[0].content);
      } else {
        const functionCallParts = functionCalls.map((fc: any) => ({
          functionCall: {
            name: fc.name || '',
            args: fc.args,
          },
        }));
        contents.push({
          role: 'model',
          parts: functionCallParts,
        });
      }

      // Execute each tool call and append responses
      const functionResponseParts = [];
      for (const fc of functionCalls) {
        if (!fc.name) continue;
        toolsUsed.push(fc.name);
        console.log(`[GeminiChat] Executing tool: ${fc.name}...`);
        const result = await executeToolCall(fc.name, fc.args);
        console.log(`[GeminiChat] Tool ${fc.name} executed successfully`);
        functionResponseParts.push({
          functionResponse: {
            name: fc.name,
            response: { result },
          },
        });
      }

      contents.push({
        role: 'user',
        parts: functionResponseParts,
      });
    }

    return {
      answer: 'Analysis complete, but maximum tool iterations reached.',
      toolsUsed,
      executionTimeMs: Date.now() - startTime,
    };
  } catch (err: any) {
    console.error('🔴 Error in Gemini Data Chat:', err);
    throw new Error(`Gemini Data Chat failed: ${err.message}`);
  }
}
