import { Router } from 'express';
import { attachCustomer } from '../middleware/auth';
import { authRateLimit } from '../middleware/rateLimits';
import {
  register, login, deleteAccount, getProfile, updateProfile,
  verifyEmail, createReauthToken, markEmailVerified,
} from '../controllers/auth.controller';

const router = Router();

router.use(authRateLimit);
router.use(attachCustomer);

router.post('/register',             register);
router.post('/login',                login);
router.get('/profile',               getProfile);
router.put('/profile',               updateProfile);
router.delete('/account',            deleteAccount);
router.post('/verify-email',         verifyEmail);
router.post('/reauth-token',         createReauthToken);
router.post('/mark-email-verified',  markEmailVerified);

export default router;
