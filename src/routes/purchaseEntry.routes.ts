import { Router } from 'express';
import {
  createPurchaseEntries,
  createPendingEntries,
  markReceived,
  getPurchaseHistory,
  updatePurchaseEntry,
  populateAllLensSources,
} from '../controllers/purchaseEntry.controller';

const router = Router();

// POST /api/purchases/populate-all — auto populate lenses from product sell, customer Rx & lab orders
router.post('/populate-all', populateAllLensSources);

// POST /api/purchases          — body: RawEntry[]  (bulk, status=received)
router.post('/', createPurchaseEntries);

// POST /api/purchases/pending  — body: { name: string; qty: number }[]
router.post('/pending', createPendingEntries);

// PATCH /api/purchases/receive — body: { id, costPerPair, lensType?, ... }[]
router.patch('/receive', markReceived);

// PATCH /api/purchases/:id     — update costPerPair, supplier, notes, qty, etc.
router.patch('/:id', updatePurchaseEntry);
router.put('/:id', updatePurchaseEntry);

// GET  /api/purchases          — ?from=&to=&lensType=&material=&coating=&color=&sph=&status=&page=&limit=
router.get('/', getPurchaseHistory);

export default router;

