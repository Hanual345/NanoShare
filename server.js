require('dotenv').config();
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const os = require('os');
const crypto = require('crypto');
const archiver = require('archiver');
const nodemailer = require('nodemailer');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// --- Nodemailer setup for feedback ---
// IMPORTANT: Use environment variables for security, do not hardcode credentials.
// Example for Gmail (you will need an App Password):
// EMAIL_HOST=smtp.gmail.com
// EMAIL_PORT=465
// EMAIL_USER=your-email@gmail.com
// EMAIL_PASS=your-app-password
const transporter = nodemailer.createTransport({
    host: process.env.EMAIL_HOST,
    port: parseInt(process.env.EMAIL_PORT || '465', 10),
    secure: (process.env.EMAIL_PORT || '465') === '465', // true for 465, false for other ports
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
    },
});

const FEEDBACK_RECIPIENT = 'hanualjoshua@gmail.com';

// Ensure upload directory exists once at startup
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

// Clean up orphaned files from previous runs to prevent disk leaks
fs.readdirSync(uploadDir).forEach(file => {
    const filePath = path.join(uploadDir, file);
    if (fs.statSync(filePath).isFile()) {
        fs.unlinkSync(filePath);
    }
});

// Set up storage for Multer
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        // Generate a cryptographically random filename to prevent collisions
        const uniqueSuffix = crypto.randomBytes(16).toString('hex');
        cb(null, uniqueSuffix);
    }
});

// Security: Add file size limits and file type filter
const upload = multer({
    storage,
    limits: {
        fileSize: 500 * 1024 * 1024 * 1024 // 500 GB limit per file
    },
    fileFilter: (req, file, cb) => {
        // You can expand this list of allowed file types
        const allowedMimes = ['image/jpeg', 'image/png', 'image/gif', 'application/pdf', 'application/zip', 'text/plain', 'video/mp4'];
        if (allowedMimes.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error('Invalid file type. Only images, PDFs, ZIPs, text and MP4 files are allowed.'), false);
        }
    }
});

// In-memory store to map codes to file details
// Map structure: code -> { files: [{ path: string, originalName: string }], timestamp: number }
const fileMap = new Map();

// Helper to generate a 7-character alphanumeric code
function generateCode() {
    return crypto.randomBytes(4).toString('hex').slice(0, 7);
}

// ---------------------------------------------------------
// Phase 2: Core API Endpoints
// ---------------------------------------------------------

// Upload Endpoint
app.post('/api/upload', (req, res) => {
    // Use upload.any() to accept files regardless of the frontend field name ('file' or 'files')
    // Wrap it in a callback to gracefully handle Multer errors and return a proper JSON response.
    upload.any()(req, res, (err) => {
        if (err) {
            console.error('Upload Error:', err.message);
            return res.status(400).json({ error: err.message });
        }

        if (!req.files || req.files.length === 0) {
            return res.status(400).json({ error: 'No files uploaded.' });
        }

        let code;
        // Ensure uniqueness of the code
        do {
            code = generateCode();
        } while (fileMap.has(code));

        const filesData = req.files.map((file, index) => ({
            path: file.path,
            originalName: file.originalname,
            size: file.size,
            index: index
        }));

        const fileDetails = {
            files: filesData,
            totalSize: filesData.reduce((acc, f) => acc + f.size, 0),
            timestamp: Date.now(),
            downloaded: new Set()
        };

        fileMap.set(code, fileDetails);

        const uploadedFileNames = fileDetails.files.map(f => f.originalName).join(', ');
        console.log(`Files uploaded: ${uploadedFileNames}, Code: ${code}`);
        res.json({ success: true, code: code });
    });
});

// Download Endpoint
app.get('/api/download/:code', (req, res) => {
    const code = req.params.code;
    const fileDetails = fileMap.get(code);

    if (!fileDetails) {
        return res.status(404).json({ error: 'Invalid or expired code.' });
    }

    // Generic cleanup function to run after download
    const cleanup = () => {
        console.log(`Files for code ${code} downloaded via bulk. Deleting files and code.`);
        fileDetails.files.forEach(file => {
            fs.unlink(file.path, (unlinkErr) => {
                if (unlinkErr) console.error(`Failed to delete file ${file.path}:`, unlinkErr);
            });
        });
        fileMap.delete(code);
    };

    // Cleanup when the connection is closed (successfully or not)
    res.on('close', cleanup);

    // If only one file, download it directly
    if (fileDetails.files.length === 1) {
        const file = fileDetails.files[0];
        if (!fs.existsSync(file.path)) {
            fileMap.delete(code); // Clean up dead entry
            return res.status(404).json({ error: 'File not found on server.' });
        }

        res.download(file.path, file.originalName, (err) => {
            if (err) {
                console.error('Error during single file download:', err);
            }
        });
    } else { // If multiple files, create and stream a zip archive
        const archive = archiver('zip', {
            zlib: { level: 9 } // Sets the compression level.
        });

        archive.on('error', (err) => {
            console.error('Error creating zip archive:', err);
            res.status(500).json({ error: 'Failed to create zip archive.' });
        });

        // Set headers for zip download and pipe archive to response
        res.attachment('files.zip');
        archive.pipe(res);

        fileDetails.files.forEach(file => {
            if (fs.existsSync(file.path)) {
                archive.file(file.path, { name: file.originalName });
            } else {
                console.warn(`File not found for archiving, skipping: ${file.path}`);
            }
        });

        archive.finalize();
    }
});

// Individual File Download Endpoint (for multiple files < 1GB)
app.get('/api/download/:code/:index', (req, res) => {
    const { code, index } = req.params;
    const fileDetails = fileMap.get(code);

    if (!fileDetails) {
        return res.status(404).json({ error: 'Invalid or expired code.' });
    }

    const fileIndex = parseInt(index, 10);
    const file = fileDetails.files.find(f => f.index === fileIndex);

    if (!file || !fs.existsSync(file.path)) {
        return res.status(404).json({ error: 'File not found on server.' });
    }

    res.download(file.path, file.originalName, (err) => {
        if (err) {
            console.error(`Error during individual file download (${file.originalName}):`, err);
        } else {
            console.log(`File ${file.originalName} downloaded successfully.`);
            fileDetails.downloaded.add(fileIndex);

            // If all files have been downloaded, clean up
            if (fileDetails.downloaded.size === fileDetails.files.length) {
                console.log(`All files for code ${code} downloaded individually. Deleting files and code.`);
                fileDetails.files.forEach(f => {
                    fs.unlink(f.path, (unlinkErr) => {
                        if (unlinkErr) console.error(`Failed to delete file ${f.path}:`, unlinkErr);
                    });
                });
                fileMap.delete(code);
            }
        }
    });
});

// Information Endpoint (Optional: Check if file exists without downloading)
app.get('/api/info/:code', (req, res) => {
     const code = req.params.code;
     const fileDetails = fileMap.get(code);
     if (!fileDetails) {
         return res.status(404).json({ error: 'Invalid or expired code.' });
     }
     // Return size and file list for frontend routing
     res.json({ 
         success: true, 
         totalSize: fileDetails.totalSize,
         files: fileDetails.files.map(f => ({ name: f.originalName, index: f.index })) 
     });
});

// ---------------------------------------------------------
// Phase 3: Cleanup Mechanism
// ---------------------------------------------------------
const FILE_EXPIRY_MS = 15 * 60 * 1000; // 15 minutes

setInterval(() => {
    const now = Date.now();
    for (const [code, details] of fileMap.entries()) {
        if (now - details.timestamp > FILE_EXPIRY_MS) {
            console.log(`Cleaning up expired code: ${code}`);
            details.files.forEach(file => {
                if (fs.existsSync(file.path)) {
                    fs.unlink(file.path, (err) => {
                        if (err) console.error(`Error deleting expired file ${file.path}:`, err);
                    });
                }
            });
            fileMap.delete(code);
        }
    }
}, 5 * 60 * 1000); // Run every 5 minutes

// ---------------------------------------------------------
// Feedback Endpoint
// ---------------------------------------------------------
app.post('/api/feedback', async (req, res) => {
    const { message } = req.body;

    if (!message || typeof message !== 'string' || message.trim().length === 0) {
        return res.status(400).json({ error: 'Feedback message is required.' });
    }

    // Check if email service is configured before attempting to send
    if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
        console.error('Email service is not configured. Cannot send feedback. Please set EMAIL_USER and EMAIL_PASS environment variables.');
        return res.status(500).json({ error: 'Feedback service is currently unavailable.' });
    }

    const mailOptions = {
        from: `"File Share Feedback" <${process.env.EMAIL_USER}>`,
        to: FEEDBACK_RECIPIENT,
        subject: 'New Feedback from File Share App',
        text: message.trim(),
        html: `<p>You have received new feedback:</p><pre>${message.trim()}</pre>`,
    };

    try {
        await transporter.sendMail(mailOptions);
        console.log('Feedback email sent successfully.');
        res.json({ success: true, message: 'Thank you for your feedback!' });
    } catch (error) {
        console.error('Error sending feedback email:', error);
        res.status(500).json({ error: 'Failed to send feedback.' });
    }
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n======================================================`);
    console.log(`🚀 Joshua X Care (www.joshuaxcare.online) is RUNNING`);
    console.log(`======================================================`);
    
    console.log(`\n🌐 Public Access:`);
    console.log(`   http://www.joshuaxcare.online (If DNS/Proxy is configured)`);

    console.log(`\n💻 Local Access:`);
    console.log(`   http://localhost:${PORT}`);
    
    console.log(`\n📱 To access from other devices (No Internet Required):`);
    console.log(`   (Devices must be connected to the same Wi-Fi or Hotspot)`);
    
    const nets = os.networkInterfaces();
    for (const name of Object.keys(nets)) {
        for (const net of nets[name]) {
            // Skip over non-IPv4 and internal (i.e. 127.0.0.1)
            if ((net.family === 'IPv4' || net.family === 4) && !net.internal) {
                console.log(`   -> ${name}: http://${net.address}:${PORT}`);
            }
        }
    }
    console.log(`\n======================================================\n`);
});
