import { Router } from 'express';
import { getCoatings, createCoating, updateCoating, deleteCoating } from '../controllers/coating.controller';

const router = Router();

router.get('/', getCoatings);
router.post('/', createCoating);
router.put('/:id', updateCoating);
router.delete('/:id', deleteCoating);

export default router;
