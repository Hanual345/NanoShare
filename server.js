const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const os = require('os');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

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
        // Generate a safe, random filename to prevent Path Traversal vulnerabilities
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix);
    }
});

const upload = multer({ storage });

// In-memory store to map 6-digit codes to file details
// Map structure: code -> { path: string, originalName: string, timestamp: number }
const fileMap = new Map();

// Helper to generate a 6-digit code
function generateCode() {
    return Math.floor(100000 + Math.random() * 900000).toString();
}

// ---------------------------------------------------------
// Phase 2: Core API Endpoints
// ---------------------------------------------------------

// Upload Endpoint
app.post('/api/upload', upload.single('file'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded.' });
    }

    let code;
    // Ensure uniqueness of the code
    do {
        code = generateCode();
    } while (fileMap.has(code));

    const fileDetails = {
        path: req.file.path,
        originalName: req.file.originalname,
        timestamp: Date.now()
    };

    fileMap.set(code, fileDetails);

    console.log(`File uploaded: ${req.file.originalname}, Code: ${code}`);
    res.json({ success: true, code: code });
});

// Download Endpoint
app.get('/api/download/:code', (req, res) => {
    const code = req.params.code;
    const fileDetails = fileMap.get(code);

    if (!fileDetails) {
        return res.status(404).json({ error: 'Invalid or expired code.' });
    }

    // Check if file physically exists
    if (!fs.existsSync(fileDetails.path)) {
        fileMap.delete(code); // Clean up dead entry
        return res.status(404).json({ error: 'File not found on server.' });
    }

    // Initiate download
    res.download(fileDetails.path, fileDetails.originalName, (err) => {
        if (err) {
            console.error('Error during download:', err);
            // Headers might have been sent, handle carefully
            if (!res.headersSent) {
                res.status(500).json({ error: 'Failed to download file.' });
            }
        } else {
            console.log(`File downloaded successfully. Deleting code ${code}`);
            // Phase 2 requirement: Automatically delete the file and code mapping
            fs.unlink(fileDetails.path, (unlinkErr) => {
                if (unlinkErr) console.error('Failed to delete file after download:', unlinkErr);
            });
            fileMap.delete(code);
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
     res.json({ success: true, filename: fileDetails.originalName });
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
            if (fs.existsSync(details.path)) {
                fs.unlink(details.path, (err) => {
                    if (err) console.error(`Error deleting expired file ${details.path}:`, err);
                });
            }
            fileMap.delete(code);
        }
    }
}, 5 * 60 * 1000); // Run every 5 minutes

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
