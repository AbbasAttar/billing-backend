import { Router } from 'express';
import {
    getPrescriptionsByCustomer,
    getPrescriptionById,
    createPrescription,
    updatePrescription,
    deletePrescription,
} from '../controllers/prescription.controller';

const router = Router();

router.get('/customer/:customerId', getPrescriptionsByCustomer);
router.get('/:id', getPrescriptionById);
router.post('/', createPrescription);
router.put('/:id', updatePrescription);
router.delete('/:id', deletePrescription);

export default router;
