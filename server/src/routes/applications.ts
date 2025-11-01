import express from 'express';
import { Application } from '../models';
import { Listing } from '../models';
import { User } from '../models';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import nodemailer from 'nodemailer';
import { isAuthenticated } from '../middleware/auth';

const router = express.Router();

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = 'uploads/resumes';
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({ 
  storage: storage,
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB limit
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['.pdf', '.doc', '.docx'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowedTypes.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Only PDF, DOC, and DOCX files are allowed'));
    }
  }
});

// Configure nodemailer
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER || 'ycs.maintenance.ylabs@gmail.com',
    pass: process.env.EMAIL_PASS
  }
});

// Get applications for a specific listing (professor view)
router.get('/listing/:listingId', isAuthenticated, async (req, res) => {
  try {
    const { listingId } = req.params;
    const { status } = req.query;

    let query: any = { listingId };
    if (status) {
      query.status = status;
    }

    const applications = await Application.find(query)
      .sort({ appliedAt: -1 });

    res.json({ applications });
  } catch (error) {
    console.error('Error fetching applications:', error);
    res.status(500).json({ error: 'Failed to fetch applications' });
  }
});

// Get applications for a specific student
router.get('/student/:studentId', isAuthenticated, async (req, res) => {
  try {
    const { studentId } = req.params;

    const applications = await Application.find({ studentId })
      .sort({ appliedAt: -1 });

    res.json({ applications });
  } catch (error) {
    console.error('Error fetching student applications:', error);
    res.status(500).json({ error: 'Failed to fetch applications' });
  }
});

// Submit application
router.post('/submit', upload.single('resume'), async (req, res) => {
  try {
    const {
      listingId,
      studentId,
      studentName,
      studentEmail,
      studentNetId,
      coverLetter,
      customQuestions
    } = req.body;

    // Check if listing exists and applications are enabled
    const listing = await Listing.findById(listingId);
    if (!listing) {
      return res.status(404).json({ error: 'Listing not found' });
    }

    if (!listing.applicationsEnabled) {
      return res.status(400).json({ error: 'Applications are not enabled for this listing' });
    }

    // Check if student already applied
    const existingApplication = await Application.findOne({ listingId, studentId });
    if (existingApplication) {
      return res.status(400).json({ error: 'You have already applied to this lab' });
    }

    // Parse custom questions if provided
    let parsedQuestions = [];
    if (customQuestions) {
      try {
        parsedQuestions = JSON.parse(customQuestions);
      } catch (e) {
        return res.status(400).json({ error: 'Invalid custom questions format' });
      }
    }

    // Auto-fill student information if not provided
    let finalStudentName = studentName;
    let finalStudentEmail = studentEmail;
    
    if (!finalStudentName || !finalStudentEmail) {
      const user = await User.findOne({ netid: studentId });
      if (user) {
        finalStudentName = finalStudentName || `${user.fname} ${user.lname}`;
        finalStudentEmail = finalStudentEmail || user.email;
      }
    }

    // Create application
    const application = new Application({
      _id: `${listingId}_${studentId}_${Date.now()}`,
      listingId,
      studentId,
      studentName: finalStudentName,
      studentEmail: finalStudentEmail,
      studentNetId,
      resumeUrl: req.file ? `/uploads/resumes/${req.file.filename}` : null,
      coverLetter: coverLetter || '',
      customQuestions: parsedQuestions,
      status: 'pending'
    });

    await application.save();

    // Send email to professor
    try {
      const toEmail: string = String((listing as any).ownerEmail || (listing as any).emails?.[0] || '');
      const mailOptions = {
        from: process.env.EMAIL_USER || 'ycs.maintenance.ylabs@gmail.com',
        to: toEmail,
        subject: `New Application for ${listing.title}`,
        html: `
          <h2>New Lab Application</h2>
          <p><strong>Student:</strong> ${finalStudentName} (${studentNetId})</p>
          <p><strong>Email:</strong> ${finalStudentEmail}</p>
          <p><strong>Lab:</strong> ${listing.title}</p>
          <p><strong>Applied:</strong> ${new Date().toLocaleString()}</p>
          
          ${coverLetter ? `<h3>Cover Letter:</h3><p>${coverLetter.replace(/\n/g, '<br>')}</p>` : ''}
          
          ${parsedQuestions.length > 0 ? `
            <h3>Application Questions:</h3>
            ${parsedQuestions.map((q: any) => `
              <p><strong>${q.question}</strong><br>
              ${q.answer || 'No answer provided'}</p>
            `).join('')}
          ` : ''}
          
          ${req.file ? `<p><strong>Resume:</strong> <a href="${req.protocol}://${req.get('host')}/uploads/resumes/${req.file.filename}">Download Resume</a></p>` : ''}
          
          <p>You can manage this application in your lab dashboard.</p>
        `
      };

      await transporter.sendMail(mailOptions);
    } catch (emailError) {
      console.error('Error sending email:', emailError);
      // Don't fail the application if email fails
    }

    res.json({ application, message: 'Application submitted successfully' });
  } catch (error) {
    console.error('Error submitting application:', error);
    res.status(500).json({ error: 'Failed to submit application' });
  }
});

// Update application status (professor action)
router.put('/:applicationId/status', isAuthenticated, async (req, res) => {
  try {
    const { applicationId } = req.params;
    const { status } = req.body;

    if (!['pending', 'accepted', 'rejected'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }

    const application = await Application.findByIdAndUpdate(
      applicationId,
      { 
        status, 
        updatedAt: new Date()
      },
      { new: true }
    );

    if (!application) {
      return res.status(404).json({ error: 'Application not found' });
    }

    res.json({ application, message: 'Application status updated' });
  } catch (error) {
    console.error('Error updating application status:', error);
    res.status(500).json({ error: 'Failed to update application status' });
  }
});

// Upload resume for user profile
router.post('/upload-resume', upload.single('resume'), async (req, res) => {
  try {
    const { userId } = req.body;

    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    // In this codebase, users are keyed by netid; allow passing netid as userId
    const user = await User.findOneAndUpdate(
      { netid: userId },
      { resumeUrl: `/uploads/resumes/${req.file.filename}` },
      { new: true }
    );

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({ 
      resumeUrl: `/uploads/resumes/${req.file.filename}`,
      message: 'Resume uploaded successfully' 
    });
  } catch (error) {
    console.error('Error uploading resume:', error);
    res.status(500).json({ error: 'Failed to upload resume' });
  }
});

// Get application statistics for a listing
router.get('/listing/:listingId/stats', isAuthenticated, async (req, res) => {
  try {
    const { listingId } = req.params;

    const stats = await Application.aggregate([
      { $match: { listingId } },
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 }
        }
      }
    ]);

    const formattedStats = {
      total: 0,
      pending: 0,
      accepted: 0,
      rejected: 0
    };

    stats.forEach(stat => {
      formattedStats[stat._id as keyof typeof formattedStats] = stat.count;
      formattedStats.total += stat.count;
    });

    res.json({ stats: formattedStats });
  } catch (error) {
    console.error('Error fetching application stats:', error);
    res.status(500).json({ error: 'Failed to fetch application statistics' });
  }
});

export default router;

