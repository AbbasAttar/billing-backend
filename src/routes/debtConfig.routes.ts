import { Router } from 'express';
import { getConfig, upsertConfig } from '../controllers/debtConfig.controller';

const router = Router();

router.get('/', getConfig);
router.post('/', upsertConfig);

export default router;
