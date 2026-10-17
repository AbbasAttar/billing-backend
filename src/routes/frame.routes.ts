import { Router } from 'express';
import {
  getAllFrames,
  searchFrames,
  getFrameById,
  createFrame,
  updateFrame,
  archiveFrame,
  deleteFrame,
  getFrameTagQueue,
  tagFrame,
} from '../controllers/frame.controller';

const router = Router();

router.get('/search', searchFrames);
router.get('/tag-queue', getFrameTagQueue);
router.get('/', getAllFrames);
router.get('/:id', getFrameById);
router.post('/', createFrame);
router.put('/:id', updateFrame);
router.patch('/:id/archive', archiveFrame);
router.patch('/:id/tags', tagFrame);
router.delete('/:id', deleteFrame);

export default router;
