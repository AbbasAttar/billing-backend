import { Router } from 'express';
import {
  getAllFrames,
  searchFrames,
  getFrameTrends,
  getFrameSold,
  getFrameById,
  createFrame,
  updateFrame,
  archiveFrame,
  deleteFrame,
} from '../controllers/frame.controller';

const router = Router();

router.get('/search', searchFrames);
router.get('/trends', getFrameTrends);
router.get('/sold', getFrameSold);
router.get('/', getAllFrames);
router.get('/:id', getFrameById);
router.post('/', createFrame);
router.put('/:id', updateFrame);
router.patch('/:id/archive', archiveFrame);
router.delete('/:id', deleteFrame);

export default router;
