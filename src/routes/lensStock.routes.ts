import { Router } from 'express';
import { getAll, create, update, adjust, remove, sold, demand, mergeDuplicates } from '../controllers/lensStock.controller';
import * as cut from '../controllers/cutLens.controller';

const router = Router();

// Cut (edged) lenses that came back and can be refitted. Before the /:id routes.
router.get('/cut', cut.list);
router.post('/cut', cut.create);
router.put('/cut/:id', cut.update);
router.patch('/cut/:id/used', cut.markUsed);
router.delete('/cut/:id', cut.remove);

router.get('/sold', sold);
router.get('/demand', demand);
router.get('/', getAll);
router.post('/', create);
router.post('/merge-duplicates', mergeDuplicates);
router.put('/:id', update);
router.patch('/:id/adjust', adjust);
router.delete('/:id', remove);

export default router;
