import { Router } from 'express';
import {
  getAllFragrances,
  searchFragrances,
  getFragranceById,
  createFragrance,
  updateFragrance,
  archiveFragrance,
  deleteFragrance,
  getFragranceRevenueSummary,
} from '../controllers/fragrance.controller';

const router = Router();

router.get('/search', searchFragrances);
router.get('/revenue-summary', getFragranceRevenueSummary);
router.get('/', getAllFragrances);
router.get('/:id', getFragranceById);
router.post('/', createFragrance);
router.put('/:id', updateFragrance);
router.patch('/:id/archive', archiveFragrance);
router.delete('/:id', deleteFragrance);

export default router;
