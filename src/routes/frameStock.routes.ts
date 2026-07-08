import { Router } from 'express';
import { decode, getAll, create, update, adjust, remove } from '../controllers/frameStock.controller';

const router = Router();

router.get('/decode/:code', decode);
router.get('/',             getAll);
router.post('/',            create);
router.put('/:id',          update);
router.patch('/:id/adjust', adjust);
router.delete('/:id',       remove);

export default router;
