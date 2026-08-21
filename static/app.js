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

    // Generate random UUID in JS
    function generateUUID() {
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
            var r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
        });
    }

    // Ultra-reliable Chunked Upload Handler (5MB chunks)
    startConvertBtn.addEventListener('click', async () => {
        if (!selectedFile) return;

        uploadContainer.classList.add('hidden');
        progressContainer.classList.remove('hidden');
        
        currentTaskId = generateUUID();
        const CHUNK_SIZE = 5 * 1024 * 1024; // 5MB chunks (never times out)
        const totalChunks = Math.ceil(selectedFile.size / CHUNK_SIZE);
        const whiteBg = document.getElementById('optWhiteBg').checked;
        const removePen = document.getElementById('optRemovePen').checked;

        updateProgress(0, 'Starting chunked upload...', `0 / ${totalChunks} chunks`);

        for (let i = 0; i < totalChunks; i++) {
            const start = i * CHUNK_SIZE;
            const end = Math.min(selectedFile.size, start + CHUNK_SIZE);
            const chunk = selectedFile.slice(start, end);

            const formData = new FormData();
            formData.append('chunk', chunk);
            formData.append('task_id', currentTaskId);
            formData.append('chunk_index', i);
            formData.append('total_chunks', totalChunks);
            formData.append('filename', selectedFile.name);
            formData.append('white_bg', whiteBg);
            formData.append('remove_pen', removePen);
            formData.append('high_contrast', true);

            try {
                const response = await fetch('/api/upload_chunk', {
                    method: 'POST',
                    body: formData
                });

                if (!response.ok) {
                    throw new Error(`Upload chunk ${i+1} failed`);
                }

                const uploadedMB = (end / (1024 * 1024)).toFixed(1);
                const totalMB = (selectedFile.size / (1024 * 1024)).toFixed(1);
                const uploadPct = Math.round(((i + 1) / totalChunks) * 100);
                const overallPct = Math.round((uploadPct / 100) * 20); // Map upload to 0-20%

                updateProgress(
                    overallPct, 
                    `Uploading: ${uploadedMB} MB / ${totalMB} MB (${uploadPct}%)`,
                    `Chunk ${i+1}/${totalChunks}`
                );

            } catch (err) {
                alert('Upload network error: ' + err.message);
                resetUI();
                return;
            }
        }

        // Upload complete -> start polling conversion progress
        updateProgress(20, 'Upload finished. Processing PDF pages...', 'Starting conversion...');
        pollInterval = setInterval(() => checkTaskProgress(currentTaskId), 400);
    });

    async function checkTaskProgress(taskId) {
        try {
            const res = await fetch(`/api/progress/${taskId}`);
            if (!res.ok) return;

            const data = await res.json();
            // Map conversion 0-100% to 20%-100% overall progress
            const overallPct = 20 + Math.round((data.percent / 100) * 80);
            updateProgress(overallPct, data.message, data.total_pages ? `Total Pages: ${data.total_pages}` : 'Processing pages...');

            if (data.status === 'completed' || data.percent >= 100) {
                clearInterval(pollInterval);
                setTimeout(() => showDownloadView(taskId, data.filename), 400);
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
