import { Router } from 'express';
import { registerFcmToken, unregisterFcmToken } from '../controllers/notification.controller';

const router = Router();
router.post('/fcm-token', registerFcmToken);
router.delete('/fcm-token', unregisterFcmToken);
export default router;
