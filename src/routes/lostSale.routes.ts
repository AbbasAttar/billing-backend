import { Router } from 'express';
import { createLostSale, getLostSales } from '../controllers/lostSale.controller';

const router = Router();

router.get('/', getLostSales);
router.post('/', createLostSale);

export default router;
