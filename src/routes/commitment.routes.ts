import { Router } from 'express';
import { listCommitments, createCommitment, updateCommitment, deleteCommitment } from '../controllers/commitment.controller';

const router = Router();

router.get('/', listCommitments);
router.post('/', createCommitment);
router.put('/:id', updateCommitment);
router.delete('/:id', deleteCommitment);

export default router;
