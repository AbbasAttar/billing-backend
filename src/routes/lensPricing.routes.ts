import { Router } from 'express';
import {
  getAll,
  create,
  update,
  remove,
  lookup,
  matchPricingRule,
  getQuoteHistory,
  getPresentationOptions,
  seedEnterpriseCatalog,
} from '../controllers/lensPricing.controller';
import {
  listCompanies,
  createCompany,
  updateCompany,
  removeCompany,
  getBook,
  putBook,
  getMarkup,
  putMarkup,
  resolve,
} from '../controllers/lensPriceBook.controller';

const router = Router();

// Price book v2 (docs/lens-price-book-v2-plan.md) — declared before '/:id'.
router.post('/resolve', resolve);
router.get('/companies', listCompanies);
router.post('/companies', createCompany);
router.put('/companies/:id', updateCompany);
router.delete('/companies/:id', removeCompany);
router.get('/books/:company', getBook);
router.put('/books/:company', putBook);
router.get('/markup', getMarkup);
router.put('/markup', putMarkup);

router.get('/match', matchPricingRule);
router.post('/match', matchPricingRule);
router.get('/quote-history', getQuoteHistory);
router.get('/lookup', lookup);
router.get('/options', getPresentationOptions);
router.post('/seed-enterprise', seedEnterpriseCatalog);
router.get('/', getAll);
router.post('/', create);
router.put('/:id', update);
router.delete('/:id', remove);

export default router;
