import { Router } from 'express';
import {
  createPurchaseEntries,
  createPendingEntries,
  markReceived,
  getPurchaseHistory,
} from '../controllers/purchaseEntry.controller';

const router = Router();

// POST /api/purchases          — body: RawEntry[]  (bulk, status=received)
router.post('/', createPurchaseEntries);

// POST /api/purchases/pending  — body: { name: string; qty: number }[]
router.post('/pending', createPendingEntries);

// PATCH /api/purchases/receive — body: { id, costPerPair, lensType?, ... }[]
router.patch('/receive', markReceived);

// GET  /api/purchases          — ?from=&to=&lensType=&material=&coating=&color=&sph=&status=&page=&limit=
router.get('/', getPurchaseHistory);

export default router;
