import { Router } from 'express';
import { getAll, create, update, adjust, remove, trends, sold } from '../controllers/lensStock.controller';

const router = Router();

router.get('/trends', trends);
router.get('/sold', sold);
router.get('/', getAll);
router.post('/', create);
router.put('/:id', update);
router.patch('/:id/adjust', adjust);
router.delete('/:id', remove);

export default router;
