import { Router } from 'express';
import {
  getAllFragrances,
  searchFragrances,
  getFragranceById,
  createFragrance,
  updateFragrance,
  deleteFragrance,
} from '../controllers/fragrance.controller';

const router = Router();

router.get('/search', searchFragrances);
router.get('/', getAllFragrances);
router.get('/:id', getFragranceById);
router.post('/', createFragrance);
router.put('/:id', updateFragrance);
router.delete('/:id', deleteFragrance);

export default router;
