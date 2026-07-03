import { Router } from 'express';
import { getAll, create, update, adjust, remove, trends } from '../controllers/lensStock.controller';

const router = Router();

router.get('/trends', trends);
router.get('/', getAll);
router.post('/', create);
router.put('/:id', update);
router.patch('/:id/adjust', adjust);
router.delete('/:id', remove);

export default router;
