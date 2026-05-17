import { Router } from 'express';
import { getInventoryIntelligence } from '../controllers/inventory.controller';

const router = Router();

router.get('/intelligence', getInventoryIntelligence);

export default router;
