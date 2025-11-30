// server/src/middleware/upload.ts
import multer from 'multer';

// Store files in memory as buffers (not saved to disk)
const storage = multer.memoryStorage();

export const uploadPDFs = multer({
  storage: storage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB per file
    files: 5 // Max 5 files total
  },
  fileFilter: (req, file, cb) => {
    // Only allow PDFs
    if (file.mimetype === 'application/pdf') {
      cb(null, true);
    } else {
      cb(new Error('Only PDF files are allowed'));
    }
  }
});