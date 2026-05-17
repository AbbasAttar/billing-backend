import { Router } from 'express';
import {
  getAllFrames,
  searchFrames,
  getFrameById,
  createFrame,
  updateFrame,
  deleteFrame,
} from '../controllers/frame.controller';

const router = Router();

router.get('/search', searchFrames);
router.get('/', getAllFrames);
router.get('/:id', getFrameById);
router.post('/', createFrame);
router.put('/:id', updateFrame);
router.delete('/:id', deleteFrame);

export default router;
