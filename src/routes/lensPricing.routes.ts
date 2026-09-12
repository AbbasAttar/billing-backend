import { Router } from 'express';
import { getAll, create, update, remove, lookup, getQuoteHistory } from '../controllers/lensPricing.controller';

const router = Router();

router.get('/quote-history', getQuoteHistory);
router.get('/lookup', lookup);
router.get('/', getAll);
router.post('/', create);
router.put('/:id', update);
router.delete('/:id', remove);

export default router;
