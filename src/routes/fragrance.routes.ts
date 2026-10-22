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
  mergeFragrance,
  markNotDuplicate,
} from '../controllers/fragrance.controller';
import { getFragrancePresets, updateFragrancePresets } from '../controllers/fragrancePresets.controller';

const router = Router();

router.get('/presets', getFragrancePresets);
router.put('/presets', updateFragrancePresets);
router.get('/search', searchFragrances);
router.get('/revenue-summary', getFragranceRevenueSummary);
router.get('/', getAllFragrances);
router.get('/:id', getFragranceById);
router.post('/', createFragrance);
router.put('/:id', updateFragrance);
router.patch('/:id/archive', archiveFragrance);
router.post('/:id/merge', mergeFragrance);
router.post('/:id/not-duplicate', markNotDuplicate);
router.delete('/:id', deleteFragrance);

export default router;
