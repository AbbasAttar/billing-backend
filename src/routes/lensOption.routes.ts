import { Router } from 'express';
import {
  getLensOptions,
  createLensOption,
  updateLensOption,
  deleteLensOption,
  updateLensConfigSettings,
} from '../controllers/lensOption.controller';

const router = Router();

router.get('/', getLensOptions);
router.put('/settings', updateLensConfigSettings);
router.post('/', createLensOption);
router.put('/:id', updateLensOption);
router.delete('/:id', deleteLensOption);

export default router;
