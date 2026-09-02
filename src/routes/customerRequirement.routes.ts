import { Router } from 'express';
import {
  getRequirements,
  getRequirementById,
  createRequirement,
  updateRequirement,
  updateRequirementStatus,
  deleteRequirement,
} from '../controllers/customerRequirement.controller';

const router = Router();

router.get('/', getRequirements);
router.get('/:id', getRequirementById);
router.post('/', createRequirement);
router.put('/:id', updateRequirement);
router.patch('/:id/status', updateRequirementStatus);
router.delete('/:id', deleteRequirement);

export default router;
