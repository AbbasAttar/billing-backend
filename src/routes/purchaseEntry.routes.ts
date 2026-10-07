import { Router } from 'express';
import {
  createPurchaseEntries,
  createPendingEntries,
  markReceived,
  getPurchaseHistory,
  getPurchaseCount,
  updatePurchaseEntry,
  deletePurchaseEntry,
  clearAllPurchases,
  populateAllLensSources,
  getLegacySummary,
  mapLegacyEntries,
} from '../controllers/purchaseEntry.controller';

const router = Router();

// Clear / Reset all procurement ledger entries
router.post('/clear-all', clearAllPurchases);
router.delete('/clear-all', clearAllPurchases);

// Legacy mapping endpoints
router.get('/legacy-summary', getLegacySummary);
router.post('/map-legacy', mapLegacyEntries);

// POST /api/purchases/populate-all — auto populate lenses from product sell, customer Rx & lab orders
router.post('/populate-all', populateAllLensSources);

// POST /api/purchases          — body: RawEntry[] or { header, items }
router.post('/', createPurchaseEntries);
router.post('/batch', createPurchaseEntries);

// POST /api/purchases/pending  — body: { name: string; qty: number }[]
router.post('/pending', createPendingEntries);

// PATCH /api/purchases/receive — body: { id, costPerPair, lensType?, ... }[]
router.patch('/receive', markReceived);

// PATCH /api/purchases/:id     — update costPerPair, supplier, notes, qty, etc.
router.patch('/:id', updatePurchaseEntry);
router.put('/:id', updatePurchaseEntry);

// DELETE /api/purchases/:id    — delete entry or paired entries
router.delete('/:id', deletePurchaseEntry);

// GET  /api/purchases/count?status=pending — badge count (one aggregate read)
router.get('/count', getPurchaseCount);

// GET  /api/purchases          — ?from=&to=&lensType=&material=&coating=&color=&sph=&status=&page=&limit=
router.get('/', getPurchaseHistory);

export default router;

