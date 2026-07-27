import { Router } from 'express';
import { getAll, create, update, remove } from '../controllers/frameColor.controller';

const router = Router();

router.get('/', getAll);
router.post('/', create);
router.put('/:id', update);
router.delete('/:id', remove);

export default router;
