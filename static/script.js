document.addEventListener('DOMContentLoaded', () => {
    const urlInput = document.getElementById('urlInput');
    const fetchBtn = document.getElementById('fetchBtn');
    const fetchText = document.getElementById('fetchText');
    const errorMsg = document.getElementById('errorMsg');
    
    const mediaInfo = document.getElementById('mediaInfo');
    const thumbnail = document.getElementById('thumbnail');
    const videoTitle = document.getElementById('videoTitle');
    const formatType = document.getElementById('formatType');
    const qualitySelect = document.getElementById('qualitySelect');
    const startDownloadBtn = document.getElementById('startDownloadBtn');
    
    const progressSection = document.getElementById('progressSection');
    const progressBar = document.getElementById('progressBar');
    const statusText = document.getElementById('statusText');
    const speedText = document.getElementById('speedText');
    const etaText = document.getElementById('etaText');
    
    const resultSection = document.getElementById('resultSection');
    const downloadLink = document.getElementById('downloadLink');
    const newDownloadBtn = document.getElementById('newDownloadBtn');

    let currentMediaData = null;
    let pollInterval = null;

    const showError = (msg) => {
        errorMsg.textContent = msg;
        errorMsg.style.display = 'block';
    };

    const hideError = () => {
        errorMsg.style.display = 'none';
    };

    const bytesToSize = (bytes) => {
        if (bytes === 0 || !bytes) return 'Unknown size';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    };

    const updateQualityOptions = () => {
        if (!currentMediaData) return;
        
        qualitySelect.innerHTML = '';
        const selectedType = formatType.value;
        const formats = currentMediaData.formats[selectedType === 'mp4' ? 'video' : 'audio'];

        if (formats.length === 0) {
            const opt = document.createElement('option');
            opt.textContent = 'No formats available';
            opt.disabled = true;
            qualitySelect.appendChild(opt);
            return;
        }

        formats.forEach(f => {
            const opt = document.createElement('option');
            if (selectedType === 'mp4') {
                opt.value = f.resolution;
                opt.textContent = `${f.resolution}p (${bytesToSize(f.filesize)})`;
            } else {
                opt.value = f.abr;
                opt.textContent = `${f.abr} kbps (${bytesToSize(f.filesize)})`;
            }
            qualitySelect.appendChild(opt);
        });
    };

    formatType.addEventListener('change', updateQualityOptions);

    fetchBtn.addEventListener('click', async () => {
        const url = urlInput.value.trim();
        if (!url) {
            showError("Please enter a valid YouTube URL");
            return;
        }

        hideError();
        mediaInfo.classList.add('hidden');
        progressSection.classList.add('hidden');
        resultSection.classList.add('hidden');
        
        fetchText.textContent = 'Fetching...';
        fetchBtn.disabled = true;
        
        // Add spinner to button icon later maybe

        try {
            const res = await fetch('/api/info', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url })
            });

            const data = await res.json();

            if (!res.ok) {
                throw new Error(data.error || 'Failed to fetch information');
            }

            currentMediaData = data;
            
            // Populate UI
            thumbnail.src = data.thumbnail;
            videoTitle.textContent = data.title;
            updateQualityOptions();
            
            mediaInfo.classList.remove('hidden');

        } catch (err) {
            showError(err.message);
        } finally {
            fetchText.textContent = 'Fetch Info';
            fetchBtn.disabled = false;
        }
    });

    const formatTime = (seconds) => {
        if (!seconds) return '--';
        const m = Math.floor(seconds / 60);
        const s = Math.floor(seconds % 60);
        return `${m}m ${s}s left`;
    };

    const pollStatus = async (taskId) => {
        try {
            const res = await fetch(`/api/status/${taskId}`);
            const data = await res.json();
            
            if (!res.ok) throw new Error(data.error);

            if (data.status === 'downloading' || data.status === 'starting') {
                progressBar.style.width = `${data.progress || 0}%`;
                statusText.textContent = data.status === 'starting' ? 'Preparing Download...' : `Downloading... ${data.progress}%`;
                speedText.textContent = data.speed || 'Calculating...';
                etaText.textContent = formatTime(data.eta);
            } 
            else if (data.status === 'processing') {
                statusText.textContent = 'Converting and processing file...';
                progressBar.style.width = '100%';
                speedText.textContent = '';
                etaText.textContent = 'Almost done...';
            }
            else if (data.status === 'done') {
                clearInterval(pollInterval);
                progressSection.classList.add('hidden');
                resultSection.classList.remove('hidden');
                
                downloadLink.href = `/api/download/${taskId}`;
            }
            else if (data.status === 'error') {
                clearInterval(pollInterval);
                progressSection.classList.add('hidden');
                showError("Processing failed: " + data.error);
            }
            
        } catch (err) {
            console.error("Polling error", err);
            clearInterval(pollInterval);
            progressSection.classList.add('hidden');
            showError("Connection lost while checking status.");
        }
    };

    startDownloadBtn.addEventListener('click', async () => {
        const url = urlInput.value.trim();
        const format = formatType.value;
        const quality = qualitySelect.value;
        
        hideError();
        mediaInfo.classList.add('hidden');
        progressSection.classList.remove('hidden');
        
        progressBar.style.width = '0%';
        statusText.textContent = 'Initializing task...';
        speedText.textContent = '--';
        etaText.textContent = '--';

        try {
            const res = await fetch('/api/process', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url, format, quality })
            });

            const data = await res.json();
            
            if (!res.ok) {
                throw new Error(data.error || 'Failed to start processing');
            }

            pollInterval = setInterval(() => pollStatus(data.task_id), 1000);

        } catch (err) {
            progressSection.classList.add('hidden');
            showError(err.message);
        }
    });

    newDownloadBtn.addEventListener('click', () => {
        resultSection.classList.add('hidden');
        urlInput.value = '';
        urlInput.focus();
    });
});
