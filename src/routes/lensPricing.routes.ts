import { Router } from 'express';
import { getAll, create, update, remove, lookup } from '../controllers/lensPricing.controller';

const router = Router();

router.get('/lookup', lookup);
router.get('/', getAll);
router.post('/', create);
router.put('/:id', update);
router.delete('/:id', remove);

export default router;
