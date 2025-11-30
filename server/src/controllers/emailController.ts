import { Request, Response } from 'express';
import { sendRelayEmail } from '../services/emailService';
import { logEvent } from '../services/analyticsService';
import { AnalyticsEventType } from '../models/analytics';

export const sendContactEmail = async (req: Request, res: Response) => {
  try {
    const { studentName, studentEmail, professorEmail, subject, message, cc, bcc } = req.body;
    const currentUser = req.user as { netId?: string, userType: string };
    
    if (!studentName || !studentEmail || !professorEmail || !subject || !message) {
      return res.status(400).json({ 
        error: 'Missing required fields',
        required: ['studentName', 'studentEmail', 'professorEmail', 'subject', 'message']
      });
    }

    const ccArray = cc ? (Array.isArray(cc) ? cc : [cc]) : [];
    const bccArray = bcc ? (Array.isArray(bcc) ? bcc : [bcc]) : [];

    const attachments = (req.files as Express.Multer.File[]) || [];

    await sendRelayEmail({
      studentName,
      studentEmail,
      professorEmail,
      subject,
      message,
      cc: ccArray,
      bcc: bccArray,
      attachments
    });

    if (currentUser?.netId) {
      await logEvent({
        eventType: AnalyticsEventType.EMAIL_SENT,
        netid: currentUser.netId,
        userType: currentUser.userType,
        metadata: {
          studentEmail,
          professorEmail,
          subject,
          attachmentCount: attachments.length,
          ccCount: ccArray.length,
          bccCount: bccArray.length
        }
      });
    }

    res.status(200).json({ 
      success: true,
      message: 'Email sent successfully',
      emailsSent: 1 + ccArray.length + bccArray.length,
      attachmentCount: attachments.length
    });

  } catch (error: any) {
    console.error('Email send error:', error);
    res.status(500).json({ 
      error: 'Failed to send email',
      details: error.message
    });
  }
};