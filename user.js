import { db, ref, set, get, update, onValue, push, remove, serverTimestamp } from './firebase-config.js';

// DOM Elements
const homeView = document.getElementById('homeView');
const playerView = document.getElementById('playerView');
const userStreamsGrid = document.getElementById('userStreamsGrid');
const backBtn = document.getElementById('backBtn');
const connectBtn = document.getElementById('connectBtn');
const remoteVideo = document.getElementById('remoteVideo');
const logoOverlay = document.getElementById('logoOverlay');
const liveViewerCount = document.getElementById('liveViewerCount');
const streamTitle = document.getElementById('streamTitle');
const channelName = document.getElementById('channelName');
const streamDescription = document.getElementById('streamDescription');
const streamLogo = document.getElementById('streamLogo');
const streamTimer = document.getElementById('streamTimer');
const qualitySelect = document.getElementById('qualitySelect');
const fullscreenBtn = document.getElementById('fullscreenBtn');

// State
let pc = null;
let currentStreamId = null;
let viewerId = Math.random().toString(36).substring(7);
let streamStartTime = null;
let timerInterval = null;

// Initialize Home Screen
onValue(ref(db, 'streams'), (snapshot) => {
    userStreamsGrid.innerHTML = '';
    const data = snapshot.val();
    if (!data) {
        userStreamsGrid.innerHTML = '<p>No live streams currently.</p>';
        return;
    }

    Object.keys(data).forEach(streamId => {
        const stream = data[streamId].metadata;
        const card = document.createElement('div');
        card.className = 'card animate-fade-in';
        card.innerHTML = `
            <img src="${stream.thumbnail}" style="width:100%; border-radius:8px; margin-bottom:1rem;">
            <div style="display:flex; justify-content:space-between; align-items:center;">
                <h3>${stream.title}</h3>
                <span class="live-indicator">LIVE</span>
            </div>
            <p>${stream.channel}</p>
            <button class="btn btn-primary" style="width:100%; margin-top:1rem;" onclick="joinStream('${streamId}')">Watch Now</button>
        `;
        userStreamsGrid.appendChild(card);
    });
});

window.joinStream = (streamId) => {
    currentStreamId = streamId;
    homeView.style.display = 'none';
    playerView.style.display = 'flex';
    initPlayer(streamId);
};

backBtn.onclick = () => {
    cleanup();
    playerView.style.display = 'none';
    homeView.style.display = 'block';
};

async function initPlayer(streamId) {
    // 1. Get Metadata
    onValue(ref(db, `streams/${streamId}/metadata`), (snapshot) => {
        const data = snapshot.val();
        if (!data) return;

        streamTitle.innerText = data.title;
        channelName.innerText = data.channel;
        streamDescription.innerText = data.description;
        streamLogo.style.backgroundImage = `url(${data.logo})`;

        // Sync Logo Position
        logoOverlay.style.left = `${data.logoPos.x}%`;
        logoOverlay.style.top = `${data.logoPos.y}%`;
        logoOverlay.style.width = `${data.logoPos.width}px`;
        logoOverlay.innerHTML = `<img src="${data.logo}" style="width:100%;">`;
    });

    // 2. Presence & IP Tracking
    const ip = await fetch('https://api.ipify.org?format=json').then(r => r.json()).then(d => d.ip).catch(() => 'Unknown');
    set(ref(db, `streams/${streamId}/presence/${viewerId}`), {
        ip: ip,
        joinedAt: serverTimestamp()
    });

    // 3. Stats
    onValue(ref(db, `streams/${streamId}/stats/viewerCount`), (snapshot) => {
        liveViewerCount.innerText = snapshot.val() || 0;
    });

    // 4. Timer
    onValue(ref(db, `streams/${streamId}/metadata/createdAt`), (snapshot) => {
        streamStartTime = snapshot.val();
        if (timerInterval) clearInterval(timerInterval);
        timerInterval = setInterval(updateTimer, 1000);
    });
}

function updateTimer() {
    if (!streamStartTime) return;
    const now = Date.now();
    const diff = Math.floor((now - streamStartTime) / 1000);
    const h = Math.floor(diff / 3600).toString().padStart(2, '0');
    const m = Math.floor((diff % 3600) / 60).toString().padStart(2, '0');
    const s = (diff % 60).toString().padStart(2, '0');
    streamTimer.innerText = `${h}:${m}:${s}`;
}

// Banner Carousel
const bannerImages = [
    'https://images.unsplash.com/photo-1540747734281-179377488052?auto=format&fit=crop&q=80',
    'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?auto=format&fit=crop&q=80',
    'https://images.unsplash.com/photo-1470225620780-dba8ba36b745?auto=format&fit=crop&q=80'
];
let currentBanner = 0;
function nextBanner() {
    currentBanner = (currentBanner + 1) % bannerImages.length;
    document.getElementById('banner').style.backgroundImage = `linear-gradient(rgba(0,0,0,0.5), rgba(0,0,0,0.5)), url(${bannerImages[currentBanner]})`;
    document.getElementById('banner').style.backgroundSize = 'cover';
    document.getElementById('banner').style.backgroundPosition = 'center';
}
setInterval(nextBanner, 5000);
nextBanner();

// WebRTC Signaling
let iceQueue = [];

connectBtn.onclick = async () => {
    if (pc) return;

    connectBtn.innerText = 'Connecting...';
    connectBtn.disabled = true;

    pc = new RTCPeerConnection({
        iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
    });

    pc.ontrack = (event) => {
        console.log("Track received");
        remoteVideo.srcObject = event.streams[0];
        connectBtn.style.display = 'none';
    };

    pc.onicecandidate = (event) => {
        if (event.candidate) {
            push(ref(db, `streams/${currentStreamId}/signaling/${viewerId}/iceCandidatesViewer`), event.candidate.toJSON());
        }
    };

    pc.oniceconnectionstatechange = () => {
        console.log("PC State:", pc.iceConnectionState);
        if (pc.iceConnectionState === 'disconnected') {
            connectBtn.style.display = 'block';
            connectBtn.innerText = 'Reconnecting...';
        }
    };

    // Listen for Offer
    onValue(ref(db, `streams/${currentStreamId}/signaling/${viewerId}/offer`), async (snapshot) => {
        const offer = snapshot.val();
        if (offer && (pc.signalingState === 'stable' || pc.signalingState === 'have-local-offer')) {
            try {
                await pc.setRemoteDescription(new RTCSessionDescription(offer));
                const answer = await pc.createAnswer();
                await pc.setLocalDescription(answer);
                await set(ref(db, `streams/${currentStreamId}/signaling/${viewerId}/answer`), {
                    sdp: answer.sdp,
                    type: answer.type
                });

                // Process queue
                iceQueue.forEach(cand => pc.addIceCandidate(new RTCIceCandidate(cand)).catch(e => console.error(e)));
                iceQueue = [];
            } catch (e) { console.error("Signaling error:", e); }
        }
    });

    // Listen for ICE candidates from Broadcaster
    onValue(ref(db, `streams/${currentStreamId}/signaling/${viewerId}/iceCandidatesBroadcaster`), (snapshot) => {
        snapshot.forEach(child => {
            const candidate = child.val();
            if (pc.remoteDescription && pc.remoteDescription.type) {
                pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(e => console.error(e));
            } else {
                iceQueue.push(candidate);
            }
        });
    });
};

// Player Controls
fullscreenBtn.onclick = () => {
    if (!document.fullscreenElement) {
        document.getElementById('mainPlayerContainer').requestFullscreen();
    } else {
        document.exitFullscreen();
    }
};

qualitySelect.onchange = (e) => {
    const q = e.target.value;
    console.log(`Switching quality to ${q}`);
    // In a real WebRTC setup, this would signal the broadcaster to lower bitrate.
    // For now, we simulate this by adjusting video filter to show feedback.
    if (q === 'low') remoteVideo.style.filter = 'blur(1px)';
    else remoteVideo.style.filter = 'none';
};

function cleanup() {
    if (pc) pc.close();
    if (timerInterval) clearInterval(timerInterval);
    if (currentStreamId) {
        remove(ref(db, `streams/${currentStreamId}/presence/${viewerId}`));
        remove(ref(db, `streams/${currentStreamId}/signaling/${viewerId}`));
    }
    pc = null;
    currentStreamId = null;
}

// Cleanup on tab close
window.onbeforeunload = cleanup;
