import { Router } from 'express';
import {
  getAllContactLenses,
  searchContactLenses,
  getContactLensById,
  createContactLens,
  updateContactLens,
  deleteContactLens,
} from '../controllers/contactLens.controller';

const router = Router();

router.get('/search', searchContactLenses);
router.get('/', getAllContactLenses);
router.get('/:id', getContactLensById);
router.post('/', createContactLens);
router.put('/:id', updateContactLens);
router.delete('/:id', deleteContactLens);

export default router;
