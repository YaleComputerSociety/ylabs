import express from 'express';
import { sendContactEmail } from '../controllers/emailController';
import { uploadPDFs } from '../middleware/upload';

const router = express.Router();

router.post('/contact', uploadPDFs.array('attachments'), sendContactEmail);

export default router;