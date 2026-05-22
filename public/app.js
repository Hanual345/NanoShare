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

    let currentFile = null;

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
            handleFileSelect(e.dataTransfer.files[0]);
        }
    });

    // Click handler for file input
    fileInput.addEventListener('change', (e) => {
        if (e.target.files.length > 0) {
            handleFileSelect(e.target.files[0]);
        }
    });

    function handleFileSelect(file) {
        currentFile = file;
        selectedFileName.textContent = `Selected: ${file.name} (${(file.size / 1024 / 1024).toFixed(2)} MB)`;
        uploadBtn.disabled = false;
        
        // Reset UI if previous upload existed
        codeResultArea.style.display = 'none';
        uploadProgressContainer.style.display = 'none';
        uploadProgressBar.style.width = '0%';
    }

    uploadBtn.addEventListener('click', async () => {
        if (!currentFile) return;

        uploadBtn.disabled = true;
        uploadBtn.textContent = 'Uploading...';
        uploadProgressContainer.style.display = 'block';

        const formData = new FormData();
        formData.append('file', currentFile);

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
        // Only allow numbers
        e.target.value = e.target.value.replace(/[^0-9]/g, '');
        
        if (e.target.value.length === 6) {
            downloadBtn.disabled = false;
        } else {
            downloadBtn.disabled = true;
        }
        receiveError.style.display = 'none';
    });

    downloadBtn.addEventListener('click', async () => {
        const code = codeInput.value;
        if (code.length !== 6) return;

        downloadBtn.disabled = true;
        downloadBtn.textContent = 'Checking...';
        receiveError.style.display = 'none';

        try {
            // First check if the file exists to give immediate feedback
            const infoResponse = await fetch(`/api/info/${code}`);
            
            if (infoResponse.ok) {
                // File exists, start actual download
                downloadBtn.textContent = 'Downloading...';
                window.location.href = `/api/download/${code}`;
                
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
});
