import { Router } from 'express';
import { getAuditLog } from '../controllers/auditLog.controller';

// Admin-only (not a staff area in middleware/accessPolicy.ts).
const router = Router();

router.get('/', getAuditLog);

export default router;
