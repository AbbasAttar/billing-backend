import { Router } from 'express';
import {
  listCampaigns,
  createCampaign,
  getCampaign,
  updateCampaign,
  deleteCampaign,
  sendCampaign,
  logConversion,
} from '../controllers/campaign.controller';

const router = Router();

router.get('/', listCampaigns);
router.post('/', createCampaign);
router.get('/:id', getCampaign);
router.patch('/:id', updateCampaign);
router.delete('/:id', deleteCampaign);
router.post('/:id/send', sendCampaign);
router.post('/:id/convert', logConversion);

export default router;
