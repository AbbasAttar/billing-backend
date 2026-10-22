import { Router } from 'express';
import {
  getParties,
  createParty,
  updateParty,
  getJobs,
  createJob,
  updateJob,
  deleteJob,
  createStatement,
  getStatements,
  getStatement,
  updateStatement,
  deleteStatement,
} from '../controllers/fitting.controller';

// Lens fitting for other opticians / doctors: jobs run up an account, billed by statement.
const router = Router();

router.get('/parties', getParties);
router.post('/parties', createParty);
router.patch('/parties/:id', updateParty);

router.get('/jobs', getJobs);
router.post('/jobs', createJob);
router.patch('/jobs/:id', updateJob);
router.delete('/jobs/:id', deleteJob);

router.get('/statements', getStatements);
router.post('/statements', createStatement);
router.get('/statements/:id', getStatement);
router.patch('/statements/:id', updateStatement);
router.delete('/statements/:id', deleteStatement);

export default router;
