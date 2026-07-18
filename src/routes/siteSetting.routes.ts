import { Router } from 'express';
import { getSetting, putSetting } from '../controllers/siteSetting.controller';

const router = Router();

router.get('/:key', getSetting);
router.put('/:key', putSetting);

export default router;
