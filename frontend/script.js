const videoUrlInput = document.getElementById('videoUrl');
const fetchBtn = document.getElementById('fetchBtn');
const clearBtn = document.getElementById('clearBtn');
const loadingSpinner = document.getElementById('loadingSpinner');
const errorMessage = document.getElementById('errorMessage');
const errorText = document.getElementById('errorText');
const videoPreview = document.getElementById('videoPreview');
const thumbnail = document.getElementById('thumbnail');
const videoTitle = document.getElementById('videoTitle');
const channelName = document.getElementById('channelName');
const views = document.getElementById('views');
const likes = document.getElementById('likes');
const uploadDate = document.getElementById('uploadDate');
const duration = document.getElementById('duration');
const choiceSection = document.getElementById('choiceSection');
const choiceGrid = document.getElementById('choiceGrid');
const qualitySection = document.getElementById('qualitySection');
const qualityGrid = document.getElementById('qualityGrid');
const qualityTitle = document.getElementById('qualityTitle');
const qualitySubtitle = document.getElementById('qualitySubtitle');
const backBtn = document.getElementById('backBtn');

let currentVideoUrl = '';
let selectedFormatId = '';
let videoQualities = [];
let audioQualities = [];

if (window.location.protocol === 'file:') {
    showError('Server nahi chal raha. start_server.bat par double-click karo, phir http://127.0.0.1:5000 kholo');
    fetchBtn.disabled = true;
}

videoUrlInput.addEventListener('input', () => {
    clearBtn.style.display = videoUrlInput.value ? 'block' : 'none';
});

clearBtn.addEventListener('click', () => {
    videoUrlInput.value = '';
    clearBtn.style.display = 'none';
    videoPreview.classList.add('hidden');
    errorMessage.classList.add('hidden');
    videoUrlInput.focus();
});

function formatNumber(num) {
    if (!num || isNaN(num)) return '0';
    if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
    if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
    return num.toString();
}

function formatDuration(seconds) {
    if (!seconds) return '--:--';
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
}

function formatSize(bytes) {
    if (!bytes || bytes <= 0) return '';
    if (bytes >= 1073741824) return (bytes / 1073741824).toFixed(1) + ' GB';
    if (bytes >= 1048576) return (bytes / 1048576).toFixed(0) + ' MB';
    if (bytes >= 1024) return (bytes / 1024).toFixed(0) + ' KB';
    return bytes + ' B';
}

function extractId(url) {
    const patterns = [
        /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/v\/|youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/,
        /youtube\.com\/watch\?.*v=([a-zA-Z0-9_-]{11})/,
        /^([a-zA-Z0-9_-]{11})$/
    ];
    for (const p of patterns) {
        const m = url.match(p);
        if (m) return m[1];
    }
    return null;
}

function showLoading() {
    loadingSpinner.classList.remove('hidden');
    videoPreview.classList.add('hidden');
    choiceSection.classList.add('hidden');
    qualitySection.classList.add('hidden');
}

function hideLoading() {
    loadingSpinner.classList.add('hidden');
}

function showError(msg) {
    errorText.textContent = msg;
    errorMessage.classList.remove('hidden');
}

function hideError() {
    errorMessage.classList.add('hidden');
}

/* --- fetch video --- */

fetchBtn.addEventListener('click', async () => {
    selectedFormatId = '';
    const url = videoUrlInput.value.trim();
    if (!url) { showError('Please enter a YouTube video URL.'); return; }
    if (!url.includes('youtube.com') && !url.includes('youtu.be')) {
        showError('Please enter a valid YouTube link.'); return;
    }

    currentVideoUrl = url;
    showLoading();
    hideError();

    try {
        const res = await fetch(`/api/video-info?url=${encodeURIComponent(url)}`, {
            signal: AbortSignal.timeout(30000)
        });
        if (!res.ok) {
            const err = await res.json().catch(() => ({ error: 'Server error' }));
            throw new Error(err.error || 'Video not found.');
        }
        const info = await res.json();

        thumbnail.src = info.thumbnail;
        thumbnail.onerror = () => {
            thumbnail.src = `https://img.youtube.com/vi/${extractId(url)}/hqdefault.jpg`;
        };
        videoTitle.textContent = info.title;
        channelName.textContent = info.channel;
        views.textContent = formatNumber(info.views);
        likes.textContent = formatNumber(info.likes);
        duration.textContent = formatDuration(info.duration);
        uploadDate.textContent = info.upload_date || 'Unknown';

        videoQualities = info.video_qualities || [];
        audioQualities = info.audio_qualities || [];

        hideLoading();
        videoPreview.classList.remove('hidden');
        choiceSection.classList.remove('hidden');
        qualitySection.classList.add('hidden');
        renderChoices();

        videoPreview.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (err) {
        hideLoading();
        if (err.name === 'TimeoutError') {
            showError('Request timeout. YouTube slow hai, dobara try karo.');
        } else {
            showError(err.message || 'Failed to fetch video info.');
        }
    }
});

videoUrlInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') fetchBtn.click();
});

/* --- choice buttons --- */

function renderChoices() {
    choiceGrid.innerHTML = '';

    const videoCount = videoQualities.length;
    const audioCount = audioQualities.length;

    const videoCard = createChoiceCard({
        icon: 'fa-video',
        label: 'Video Download',
        sub: videoCount > 0 ? `${videoCount} qualities available` : 'No formats',
        count: `${getTopQuality()}`
    });
    videoCard.addEventListener('click', () => showVideoQualities());

    const audioCard = createChoiceCard({
        icon: 'fa-music',
        label: 'Music Download',
        sub: audioCount > 0 ? `${audioCount} audio bitrates` : 'No formats',
        count: audioCount > 0 ? `${audioQualities[0].label}` : ''
    });
    audioCard.addEventListener('click', () => showAudioQualities());

    choiceGrid.appendChild(videoCard);
    choiceGrid.appendChild(audioCard);
}

function getTopQuality() {
    if (!videoQualities.length) return '';
    const top = videoQualities[0];
    let label = top.label;
    if (top.has_audio) label += ' with audio';
    return label;
}

function createChoiceCard({ icon, label, sub, count }) {
    const div = document.createElement('div');
    div.className = `choice-card ${icon === 'fa-music' ? 'audio' : 'video'}-card`;
    div.innerHTML = `
        <div class="choice-card-icon"><i class="fas ${icon}"></i></div>
        <div class="choice-card-label">${label}</div>
        <div class="choice-card-sub">${sub}</div>
        ${count ? `<div class="choice-card-count">${count}</div>` : ''}
    `;
    return div;
}

/* --- quality display --- */

function showVideoQualities() {
    choiceSection.classList.add('hidden');
    qualitySection.classList.remove('hidden');
    qualityTitle.innerHTML = '<i class="fas fa-video"></i> Choose Quality';
    qualitySubtitle.textContent = `With audio merging for DASH formats (${videoQualities.length} available)`;
    renderQualityGrid(videoQualities, 'video');
}

function showAudioQualities() {
    choiceSection.classList.add('hidden');
    qualitySection.classList.remove('hidden');
    qualityTitle.innerHTML = '<i class="fas fa-music"></i> Choose Audio Format';
    qualitySubtitle.textContent = `${audioQualities.length} audio formats available`;
    renderQualityGrid(audioQualities, 'audio');
}

backBtn.addEventListener('click', () => {
    qualitySection.classList.add('hidden');
    choiceSection.classList.remove('hidden');
    choiceSection.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
});

function getBadgeInfo(q, type) {
    if (type === 'audio') return { cls: 'audio', text: 'Audio' };
    const h = q.height;
    if (h >= 2160) return { cls: 'k4', text: '4K' };
    if (h >= 1440) return { cls: 'qhd', text: 'QHD' };
    if (h >= 1080) return { cls: 'fullhd', text: 'Full HD' };
    if (h >= 720) return { cls: 'hd', text: 'HD' };
    return null;
}

function getAudioTag(q) {
    if (q.has_audio) {
        return '<span class="q-audio-tag with-audio"><i class="fas fa-music"></i> With Audio</span>';
    }
    return '<span class="q-audio-tag merge"><i class="fas fa-object-group"></i> Audio merge</span>';
}

function renderQualityGrid(qualities, type) {
    qualityGrid.innerHTML = '';
    selectedFormatId = '';

    qualities.forEach((q, index) => {
        const isFirst = index === 0;

        const div = document.createElement('div');
        div.className = 'quality-option' + (isFirst ? ' selected' : '');
        if (isFirst) selectedFormatId = q.format_id;

        const badge = getBadgeInfo(q, type);
        const isAudio = type === 'audio';
        const iconClass = isAudio ? 'audio-icon' : (q.height > 720 && !q.has_audio ? 'merge-icon' : 'video-icon');
        const icon = isAudio ? 'fa-music' : (q.height > 720 && !q.has_audio ? 'fa-object-group' : 'fa-video');

        const metaParts = [];
        if (q.ext) metaParts.push(q.ext.toUpperCase());
        if (q.fps > 30 && !isAudio) metaParts.push(q.fps + 'fps');
        if (!isAudio && q.height <= 720 && q.has_audio) metaParts.push('Direct');
        const meta = metaParts.join(' · ');

        const audioTag = !isAudio ? getAudioTag(q) : '';

        div.innerHTML = `
            <div class="q-icon ${iconClass}"><i class="fas ${icon}"></i></div>
            <div class="q-info">
                <div class="q-label">${q.label}</div>
                <div class="q-meta">${meta} ${audioTag}</div>
            </div>
            ${badge ? '<div><span class="q-badge ' + badge.cls + '">' + badge.text + '</span></div>' : ''}
            <div class="q-size">${formatSize(q.filesize)}</div>
        `;

        div.addEventListener('click', () => {
            document.querySelectorAll('.quality-option').forEach(el => el.classList.remove('selected'));
            div.classList.add('selected');
            selectedFormatId = q.format_id;
        });

        qualityGrid.appendChild(div);
    });

    const downloadBtn = document.createElement('button');
    downloadBtn.className = 'download-btn-q';
    const btnLabel = type === 'audio' ? 'Download Audio' : 'Download Video';
    downloadBtn.innerHTML = `<i class="fas fa-download"></i> ${btnLabel}`;
    downloadBtn.addEventListener('click', () => handleDownload(downloadBtn, type, btnLabel));
    qualityGrid.appendChild(downloadBtn);
}

function handleDownload(btn, type, label) {
    if (!selectedFormatId || !currentVideoUrl) return;

    const selectedQ = (type === 'video' ? videoQualities : audioQualities)
        .find(q => q.format_id === selectedFormatId);

    const needsMerge = type === 'video' && selectedQ && !selectedQ.has_audio;

    btn.disabled = true;
    btn.classList.add('merging');

    if (needsMerge) {
        btn.innerHTML = '<i class="fas fa-spinner fa-pulse"></i> Downloading + merging audio...';

        const progressDiv = document.createElement('div');
        progressDiv.className = 'merging-progress';
        progressDiv.id = 'mergeProgress';
        progressDiv.textContent = 'Downloading video and audio, then merging with ffmpeg...';
        btn.parentElement.appendChild(progressDiv);
    } else {
        btn.innerHTML = '<i class="fas fa-spinner fa-pulse"></i> Starting download...';
    }

    const has_audio = selectedQ ? selectedQ.has_audio : true;
    window.location.href = `/api/download?url=${encodeURIComponent(currentVideoUrl)}&format_id=${selectedFormatId}&type=${type}&has_audio=${has_audio}`;

    setTimeout(() => {
        btn.disabled = false;
        btn.classList.remove('merging');
        btn.innerHTML = `<i class="fas fa-download"></i> ${label}`;
        const prog = document.getElementById('mergeProgress');
        if (prog) prog.remove();
    }, 30000);
}
