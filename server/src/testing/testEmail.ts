// server/src/testEmail.ts
import nodemailer from 'nodemailer';
import dotenv from 'dotenv';
import path from 'path';

// Explicitly load .env from server directory
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

async function testEmail() {
  // Debug: Check if env vars are loaded
  console.log('EMAIL_HOST:', process.env.EMAIL_HOST);
  console.log('EMAIL_PORT:', process.env.EMAIL_PORT);
  console.log('EMAIL_USER:', process.env.EMAIL_USER);
  console.log('EMAIL_PASSWORD:', process.env.EMAIL_PASSWORD ? '***SET***' : 'NOT SET');

  if (!process.env.EMAIL_HOST || !process.env.EMAIL_USER || !process.env.EMAIL_PASSWORD) {
    console.error('❌ Environment variables not loaded! Check your .env file.');
    return;
  }

  const transporter = nodemailer.createTransport({
    host: process.env.EMAIL_HOST,
    port: Number(process.env.EMAIL_PORT),
    secure: false,
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASSWORD
    }
  });

  try {
    await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to: 'sebastian.gonzalez@yale.edu', // PUT YOUR EMAIL HERE
      subject: 'Test Email from YaleLabs',
      text: 'If you receive this, the email service is working!'
    });
    console.log('✅ Test email sent successfully!');
  } catch (error) {
    console.error('❌ Error sending test email:', error);
  }
}

testEmail();