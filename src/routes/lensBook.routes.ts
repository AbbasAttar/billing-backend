import { Router } from 'express';
import { addLensBook, deleteLensBook, lensLongTerm, listLensBook, updateLensBook } from '../controllers/lensBook.controller';

// Lens sales copied from the old paper books (analytics only). Admin-only: not a staff area.
const router = Router();

router.get('/', listLensBook);
router.get('/summary', lensLongTerm);
router.post('/', addLensBook);
router.put('/:id', updateLensBook);
router.delete('/:id', deleteLensBook);

export default router;
