document.addEventListener('DOMContentLoaded', () => {
    const dropZone = document.getElementById('dropZone');
    const fileInput = document.getElementById('fileInput');
    const fileDetails = document.getElementById('fileDetails');
    const fileName = document.getElementById('fileName');
    const fileSize = document.getElementById('fileSize');
    const removeFileBtn = document.getElementById('removeFileBtn');
    const startConvertBtn = document.getElementById('startConvertBtn');
    
    const uploadContainer = document.getElementById('uploadContainer');
    const progressContainer = document.getElementById('progressContainer');
    const downloadContainer = document.getElementById('downloadContainer');
    
    const progressBar = document.getElementById('progressBar');
    const percentText = document.getElementById('percentText');
    const pageStats = document.getElementById('pageStats');
    const progressMessage = document.getElementById('progressMessage');
    
    const downloadBtn = document.getElementById('downloadBtn');
    const convertAnotherBtn = document.getElementById('convertAnotherBtn');
    
    let selectedFile = null;
    let pollInterval = null;
    let currentTaskId = null;

    dropZone.addEventListener('click', () => fileInput.click());

    ['dragenter', 'dragover'].forEach(eventName => {
        dropZone.addEventListener(eventName, (e) => {
            e.preventDefault();
            e.stopPropagation();
            dropZone.classList.add('border-brand-500', 'bg-brand-500/10');
        });
    });

    ['dragleave', 'drop'].forEach(eventName => {
        dropZone.addEventListener(eventName, (e) => {
            e.preventDefault();
            e.stopPropagation();
            dropZone.classList.remove('border-brand-500', 'bg-brand-500/10');
        });
    });

    dropZone.addEventListener('drop', (e) => {
        const files = e.dataTransfer.files;
        if (files.length > 0 && files[0].type === 'application/pdf') {
            handleFileSelect(files[0]);
        } else {
            alert('Please select a valid PDF file.');
        }
    });

    fileInput.addEventListener('change', (e) => {
        if (fileInput.files.length > 0) {
            handleFileSelect(fileInput.files[0]);
        }
    });

    function handleFileSelect(file) {
        if (!file.name.toLowerCase().endsWith('.pdf')) {
            alert('Only PDF files are supported.');
            return;
        }
        selectedFile = file;
        fileName.textContent = file.name;
        fileSize.textContent = (file.size / (1024 * 1024)).toFixed(2) + ' MB';
        
        fileDetails.classList.remove('hidden');
        startConvertBtn.disabled = false;
    }

    removeFileBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        selectedFile = null;
        fileInput.value = '';
        fileDetails.classList.add('hidden');
        startConvertBtn.disabled = true;
    });

    startConvertBtn.addEventListener('click', () => {
        if (!selectedFile) return;

        const formData = new FormData();
        formData.append('file', selectedFile);
        formData.append('white_bg', document.getElementById('optWhiteBg').checked);
        formData.append('remove_pen', document.getElementById('optRemovePen').checked);
        formData.append('high_contrast', true);

        uploadContainer.classList.add('hidden');
        progressContainer.classList.remove('hidden');
        updateProgress(0, 'Starting file upload...', 'Initializing...');

        const xhr = new XMLHttpRequest();
        
        // Track live upload progress for large files (up to 2GB)
        xhr.upload.onprogress = (e) => {
            if (e.lengthComputable) {
                const uploadedMB = (e.loaded / (1024 * 1024)).toFixed(1);
                const totalMB = (e.total / (1024 * 1024)).toFixed(1);
                const uploadPct = Math.round((e.loaded / e.total) * 100);
                
                // Map upload phase to 0% - 20% overall progress
                const overallPct = Math.round(uploadPct * 0.20);
                updateProgress(
                    overallPct, 
                    `Uploading: ${uploadedMB} MB / ${totalMB} MB (${uploadPct}%)`,
                    `Upload Progress: ${uploadPct}%`
                );
            }
        };

        xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) {
                try {
                    const data = JSON.parse(xhr.responseText);
                    currentTaskId = data.task_id;
                    updateProgress(20, 'Upload finished. Processing PDF pages...', 'Starting conversion...');
                    pollInterval = setInterval(() => checkTaskProgress(currentTaskId), 500);
                } catch (e) {
                    alert('Error parsing upload response.');
                    resetUI();
                }
            } else {
                alert('Upload error: HTTP ' + xhr.status);
                resetUI();
            }
        };

        xhr.onerror = () => {
            alert('Upload network error. Please try again.');
            resetUI();
        };

        xhr.open('POST', '/api/upload', true);
        xhr.send(formData);
    });

    async function checkTaskProgress(taskId) {
        try {
            const res = await fetch(`/api/progress/${taskId}`);
            if (!res.ok) return;

            const data = await res.json();
            // Map server progress 0-100% to 20%-100% overall progress
            const overallPct = 20 + Math.round((data.percent / 100) * 80);
            updateProgress(overallPct, data.message, data.total_pages ? `Total Pages: ${data.total_pages}` : 'Processing pages...');

            if (data.status === 'completed' || data.percent >= 100) {
                clearInterval(pollInterval);
                setTimeout(() => showDownloadView(taskId, data.filename), 500);
            } else if (data.status === 'failed') {
                clearInterval(pollInterval);
                alert('Conversion failed: ' + data.message);
                resetUI();
            }
        } catch (e) {
            console.error('Polling error:', e);
        }
    }

    function updateProgress(percent, message, pageText) {
        progressBar.style.width = `${percent}%`;
        percentText.textContent = `${percent}%`;
        progressMessage.textContent = message;
        if (pageText) {
            pageStats.textContent = pageText;
        }
    }

    function showDownloadView(taskId, filename) {
        progressContainer.classList.add('hidden');
        downloadContainer.classList.remove('hidden');
        
        const downloadUrl = `/api/download/${taskId}`;
        downloadBtn.href = downloadUrl;
        downloadBtn.setAttribute('download', filename);
        
        downloadBtn.onclick = (e) => {
            e.preventDefault();
            window.location.href = downloadUrl;
        };
    }

    convertAnotherBtn.addEventListener('click', () => {
        resetUI();
    });

    function resetUI() {
        if (pollInterval) clearInterval(pollInterval);
        selectedFile = null;
        currentTaskId = null;
        fileInput.value = '';
        fileDetails.classList.add('hidden');
        startConvertBtn.disabled = true;
        
        progressContainer.classList.add('hidden');
        downloadContainer.classList.add('hidden');
        uploadContainer.classList.remove('hidden');
    }
});
