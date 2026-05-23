document.addEventListener('DOMContentLoaded', () => {
    // --- Navigation Logic ---
    const navBtns = document.querySelectorAll('.nav-btn');
    const views = document.querySelectorAll('.view-section');

    navBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            // Remove active class from all buttons and views
            navBtns.forEach(b => b.classList.remove('active'));
            views.forEach(v => v.classList.remove('active-view'));

            // Add active class to clicked button and corresponding view
            btn.classList.add('active');
            const targetId = btn.getAttribute('data-target');
            document.getElementById(targetId).classList.add('active-view');
        });
    });

    // --- Send Logic ---
    const uploadArea = document.getElementById('uploadArea');
    const fileInput = document.getElementById('fileInput');
    const selectedFileName = document.getElementById('selectedFileName');
    const uploadBtn = document.getElementById('uploadBtn');
    const uploadProgressContainer = document.getElementById('uploadProgressContainer');
    const uploadProgressBar = document.getElementById('uploadProgressBar');
    const codeResultArea = document.getElementById('codeResultArea');
    const generatedCode = document.getElementById('generatedCode');

    let currentFiles = [];

    // Drag and drop handlers
    uploadArea.addEventListener('dragover', (e) => {
        e.preventDefault();
        uploadArea.classList.add('dragover');
    });

    uploadArea.addEventListener('dragleave', () => {
        uploadArea.classList.remove('dragover');
    });

    uploadArea.addEventListener('drop', (e) => {
        e.preventDefault();
        uploadArea.classList.remove('dragover');
        if (e.dataTransfer.files.length > 0) {
            handleFilesSelect(e.dataTransfer.files);
        }
    });

    // Click handler for file input
    fileInput.addEventListener('change', (e) => {
        if (e.target.files.length > 0) {
            handleFilesSelect(e.target.files);
        }
    });

    function handleFilesSelect(files) {
        // Add new files to the existing array instead of replacing them
        const newFiles = Array.from(files);
        currentFiles = currentFiles.concat(newFiles);

        if (currentFiles.length === 1) {
             selectedFileName.textContent = `Selected: ${currentFiles[0].name} (${(currentFiles[0].size / 1024 / 1024).toFixed(2)} MB)`;
        } else {
             const totalSize = currentFiles.reduce((acc, file) => acc + file.size, 0);
             selectedFileName.textContent = `Selected: ${currentFiles.length} files (${(totalSize / 1024 / 1024).toFixed(2)} MB)`;
        }
        uploadBtn.disabled = false;
        
        // Reset UI if previous upload existed
        codeResultArea.style.display = 'none';
        uploadProgressContainer.style.display = 'none';
        uploadProgressBar.style.width = '0%';
    }

    uploadBtn.addEventListener('click', async () => {
        if (currentFiles.length === 0) return;

        uploadBtn.disabled = true;
        uploadBtn.textContent = 'Uploading...';
        uploadProgressContainer.style.display = 'block';

        const formData = new FormData();
        currentFiles.forEach(file => {
            formData.append('files', file);
        });

        try {
            // Using XMLHttpRequest for upload progress
            const xhr = new XMLHttpRequest();
            
            xhr.upload.addEventListener('progress', (event) => {
                if (event.lengthComputable) {
                    const percentComplete = (event.loaded / event.total) * 100;
                    uploadProgressBar.style.width = percentComplete + '%';
                }
            });

            xhr.addEventListener('load', () => {
                if (xhr.status === 200) {
                    const response = JSON.parse(xhr.responseText);
                    if (response.success) {
                        generatedCode.textContent = response.code;
                        codeResultArea.style.display = 'block';
                        uploadBtn.textContent = 'Uploaded!';
                        // Clear the selected files list after a successful upload
                        currentFiles = [];
                    } else {
                        alert('Upload failed: ' + response.error);
                        uploadBtn.textContent = 'Generate Code';
                        uploadBtn.disabled = false;
                    }
                } else {
                    alert('Upload failed. Server returned status: ' + xhr.status);
                    uploadBtn.textContent = 'Generate Code';
                    uploadBtn.disabled = false;
                }
            });

            xhr.addEventListener('error', () => {
                alert('Upload failed. Network error.');
                uploadBtn.textContent = 'Generate Code';
                uploadBtn.disabled = false;
            });

            xhr.open('POST', '/api/upload', true);
            xhr.send(formData);

        } catch (error) {
            console.error('Error during upload:', error);
            alert('An unexpected error occurred.');
            uploadBtn.textContent = 'Generate Code';
            uploadBtn.disabled = false;
        }
    });

    // --- Receive Logic ---
    const codeInput = document.getElementById('codeInput');
    const downloadBtn = document.getElementById('downloadBtn');
    const receiveError = document.getElementById('receiveError');

    codeInput.addEventListener('input', (e) => {
        // Allow alphanumeric characters and make it lowercase
        e.target.value = e.target.value.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
        
        if (e.target.value.length === 7) {
            downloadBtn.disabled = false;
        } else {
            downloadBtn.disabled = true;
        }
        receiveError.style.display = 'none';
    });

    downloadBtn.addEventListener('click', async () => {
        const code = codeInput.value;
        if (code.length !== 7) return;

        downloadBtn.disabled = true;
        downloadBtn.textContent = 'Checking...';
        receiveError.style.display = 'none';

        try {
            // First check if the file exists to give immediate feedback
            const infoResponse = await fetch(`/api/info/${code}`);
            
            if (infoResponse.ok) {
                const data = await infoResponse.json();
                const ONE_GB = 1024 * 1024 * 1024;

                if (data.files && data.files.length > 1 && data.totalSize < ONE_GB) {
                    try {
                        // Modern browsers: Prompt user to select/create a folder
                        if (window.showDirectoryPicker) {
                            downloadBtn.textContent = 'Select Folder to Save...';
                            const dirHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
                            downloadBtn.textContent = 'Downloading files...';
                            
                            for (const file of data.files) {
                                const fileHandle = await dirHandle.getFileHandle(file.name, { create: true });
                                const writable = await fileHandle.createWritable();
                                const response = await fetch(`/api/download/${code}/${file.index}`);
                                await response.body.pipeTo(writable);
                            }
                        } else {
                            // Fallback for Firefox/Safari: Download individually
                            downloadBtn.textContent = 'Downloading files...';
                            data.files.forEach(file => {
                                const a = document.createElement('a');
                                a.href = `/api/download/${code}/${file.index}`;
                                a.download = file.name;
                                a.style.display = 'none';
                                document.body.appendChild(a);
                                a.click();
                                document.body.removeChild(a);
                            });
                        }
                    } catch (err) {
                        // If the user hits "Cancel" on the folder prompt, just reset the button
                        if (err.name === 'AbortError') {
                            downloadBtn.textContent = 'Download File';
                            downloadBtn.disabled = false;
                            return; 
                        } else {
                            console.error('Folder save failed:', err);
                            receiveError.textContent = 'Failed to save to folder. Try again.';
                            receiveError.style.display = 'block';
                            downloadBtn.textContent = 'Download File';
                            downloadBtn.disabled = false;
                            return;
                        }
                    }
                } else {
                    // Single file OR Zip if >= 1GB
                    downloadBtn.textContent = 'Downloading...';
                    window.location.href = `/api/download/${code}`;
                }
                
                // Reset UI after a short delay
                setTimeout(() => {
                    downloadBtn.textContent = 'Download File';
                    downloadBtn.disabled = true;
                    codeInput.value = '';
                }, 2000);

            } else {
                // File doesn't exist or code invalid
                const errorData = await infoResponse.json();
                receiveError.textContent = errorData.error || 'Invalid code.';
                receiveError.style.display = 'block';
                downloadBtn.textContent = 'Download File';
                downloadBtn.disabled = false;
            }

        } catch (error) {
            console.error('Error checking code:', error);
            receiveError.textContent = 'Network error. Could not connect to server.';
            receiveError.style.display = 'block';
            downloadBtn.textContent = 'Download File';
            downloadBtn.disabled = false;
        }
    });

    // --- Feedback Logic ---
    const feedbackMessage = document.getElementById('feedbackMessage');
    const submitFeedbackBtn = document.getElementById('submitFeedbackBtn');
    const feedbackStatus = document.getElementById('feedbackStatus');

    if (submitFeedbackBtn && feedbackMessage) {
        submitFeedbackBtn.addEventListener('click', async () => {
            const message = feedbackMessage.value.trim();
            if (!message) return;

            submitFeedbackBtn.disabled = true;
            submitFeedbackBtn.textContent = 'Sending...';
            feedbackStatus.style.display = 'none';

            try {
                const response = await fetch('/api/feedback', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ message })
                });
                
                const data = await response.json();
                
                feedbackStatus.textContent = data.success ? data.message : (data.error || 'Failed to send feedback.');
                feedbackStatus.style.color = data.success ? 'green' : 'red';
                feedbackStatus.style.display = 'block';
                
                if (data.success) feedbackMessage.value = '';
            } catch (error) {
                feedbackStatus.textContent = 'Network error. Please try again.';
                feedbackStatus.style.color = 'red';
                feedbackStatus.style.display = 'block';
            } finally {
                submitFeedbackBtn.disabled = false;
                submitFeedbackBtn.innerHTML = '<i class="fa-solid fa-paper-plane"></i> Submit Feedback';
            }
        });
    }
});
