import { Router } from 'express';
import {
    getAllOpticalLenses,
    searchOpticalLenses,
    getOpticalLensById,
    createOpticalLens,
    updateOpticalLens,
    deleteOpticalLens,
} from '../controllers/opticalLens.controller';

const router = Router();

router.get('/search', searchOpticalLenses);
router.get('/', getAllOpticalLenses);
router.get('/:id', getOpticalLensById);
router.post('/', createOpticalLens);
router.put('/:id', updateOpticalLens);
router.delete('/:id', deleteOpticalLens);

export default router;
