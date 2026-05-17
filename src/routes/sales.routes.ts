import { Router } from 'express';
import { getSalesIntelligence } from '../controllers/sales.controller';

const router = Router();

router.get('/intelligence', getSalesIntelligence);

export default router;
