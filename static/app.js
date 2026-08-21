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

    startConvertBtn.addEventListener('click', async () => {
        if (!selectedFile) return;

        const formData = new FormData();
        formData.append('file', selectedFile);
        formData.append('white_bg', document.getElementById('optWhiteBg').checked);
        formData.append('remove_pen', document.getElementById('optRemovePen').checked);
        formData.append('high_contrast', true);

        uploadContainer.classList.add('hidden');
        progressContainer.classList.remove('hidden');
        updateProgress(0, 0, 'Uploading file to server...', 0);

        try {
            const response = await fetch('/api/upload', {
                method: 'POST',
                body: formData
            });

            if (!response.ok) {
                const err = await response.json();
                throw new Error(err.detail || 'Upload failed');
            }

            const data = await response.json();
            currentTaskId = data.task_id;

            pollInterval = setInterval(() => checkTaskProgress(currentTaskId), 600);

        } catch (error) {
            alert('Upload error: ' + error.message);
            resetUI();
        }
    });

    async function checkTaskProgress(taskId) {
        try {
            const res = await fetch(`/api/progress/${taskId}`);
            if (!res.ok) return;

            const data = await res.json();
            updateProgress(data.percent, data.total_pages, data.message);

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

    function updateProgress(percent, totalPages, message) {
        progressBar.style.width = `${percent}%`;
        percentText.textContent = `${percent}%`;
        progressMessage.textContent = message;
        if (totalPages > 0) {
            pageStats.textContent = `Total Pages: ${totalPages}`;
        } else {
            pageStats.textContent = 'Preparing pages...';
        }
    }

    function showDownloadView(taskId, filename) {
        progressContainer.classList.add('hidden');
        downloadContainer.classList.remove('hidden');
        
        const downloadUrl = `/api/download/${taskId}`;
        downloadBtn.href = downloadUrl;
        downloadBtn.setAttribute('download', filename);
        
        // Direct click handler for guaranteed browser download
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
