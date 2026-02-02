import nodemailer from 'nodemailer';
import dotenv from 'dotenv';

dotenv.config();

interface SendRelayEmailParams {
  studentName: string;
  studentEmail: string;
  professorEmail: string;
  subject: string;
  message: string;
  cc?: string[];
  bcc?: string[];
  attachments?: Express.Multer.File[];
}

export async function sendRelayEmail({
  studentName,
  studentEmail,
  professorEmail,
  subject,
  message,
  cc = [],
  bcc = [],
  attachments = []
}: SendRelayEmailParams): Promise<void> {
  const transporter = nodemailer.createTransport({
    host: process.env.EMAIL_HOST,
    port: Number(process.env.EMAIL_PORT),
    secure: false,
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASSWORD
    }
  });

  // Format attachments for nodemailer
  const formattedAttachments = attachments.map(file => ({
    filename: file.originalname,
    content: file.buffer
  }));

  await transporter.sendMail({
    from: `"${studentName}" <${process.env.EMAIL_USER}>`,
    to: professorEmail,
    cc: cc.length > 0 ? cc : undefined,
    bcc: bcc.length > 0 ? bcc : undefined,
    replyTo: studentEmail,
    subject: subject,
    text: message,
    html: `<p>${message.replace(/\n/g, '<br>')}</p>`,
    attachments: formattedAttachments
  });
}