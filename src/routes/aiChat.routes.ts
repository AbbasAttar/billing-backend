import { Router } from 'express';
import { handleDataChat } from '../controllers/aiChat.controller';

const router = Router();

router.post('/data-chat', handleDataChat);

export default router;
