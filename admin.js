import { db, ref, set, get, update, onValue, push, remove, serverTimestamp } from './firebase-config.js';

// DOM Elements
const createStreamBtn = document.getElementById('createStreamBtn');
const createStreamModal = document.getElementById('createStreamModal');
const closeModalBtn = document.getElementById('closeModal');
const createStreamForm = document.getElementById('createStreamForm');
const streamsGrid = document.getElementById('streamsGrid');

// State
let activeBroadcasters = {}; // {streamId: BroadcasterInstance}

// Modal Logic
createStreamBtn.onclick = () => createStreamModal.style.display = 'flex';
closeModalBtn.onclick = () => createStreamModal.style.display = 'none';
window.onclick = (e) => { if (e.target === createStreamModal) createStreamModal.style.display = 'none'; };

// Create Stream
createStreamForm.onsubmit = async (e) => {
    e.preventDefault();
    const formData = new FormData(createStreamForm);
    const streamData = {
        title: formData.get('title'),
        channel: formData.get('channel'),
        thumbnail: formData.get('thumbnail'),
        logo: formData.get('logo'),
        description: formData.get('description'),
        logoPos: { x: 10, y: 10, width: 100 }, // Default position
        status: 'live',
        createdAt: serverTimestamp()
    };

    const newStreamRef = push(ref(db, 'streams'));
    const streamId = newStreamRef.key;

    await set(ref(db, `streams/${streamId}/metadata`), streamData);

    createStreamModal.style.display = 'none';
    createStreamForm.reset();

    // Auto-start managing the new stream
    startBroadcasting(streamId, streamData);
};

// List Streams
onValue(ref(db, 'streams'), (snapshot) => {
    streamsGrid.innerHTML = '';
    const data = snapshot.val();
    if (!data) {
        streamsGrid.innerHTML = '<div class="card empty-state"><p>No active streams.</p></div>';
        return;
    }

    Object.keys(data).forEach(streamId => {
        const stream = data[streamId].metadata;
        const card = document.createElement('div');
        card.className = 'card animate-fade-in';
        card.innerHTML = `
            <img src="${stream.thumbnail}" style="width:100%; border-radius:8px; margin-bottom:1rem;">
            <h3>${stream.title}</h3>
            <p>${stream.channel}</p>
            <div style="display:flex; gap:1rem; margin-top:1rem;">
                <button class="btn btn-primary manage-btn" data-id="${streamId}">Manage</button>
                <button class="btn btn-outline end-btn" data-id="${streamId}">End Stream</button>
            </div>
        `;
        streamsGrid.appendChild(card);

        card.querySelector('.manage-btn').onclick = () => startBroadcasting(streamId, stream);
        card.querySelector('.end-btn').onclick = () => endStream(streamId);
    });
});

async function endStream(streamId) {
    if (confirm('Are you sure you want to end this stream?')) {
        if (activeBroadcasters[streamId]) {
            activeBroadcasters[streamId].stop();
            delete activeBroadcasters[streamId];
        }
        await remove(ref(db, `streams/${streamId}`));
    }
}

// Broadcaster Logic
class LifeLiveBroadcaster {
    constructor(streamId, metadata) {
        this.streamId = streamId;
        this.metadata = metadata;
        this.stream = null;
        this.peerConnections = {}; // {viewerId: RTCPeerConnection}
        this.iceQueues = {}; // {viewerId: [candidates]}
        this.logoElement = null;
    }

    async init() {
        try {
            this.stream = await navigator.mediaDevices.getDisplayMedia({
                video: { cursor: "always" },
                audio: true
            });

            this.setupUI();
            this.listenForViewers();

            this.stream.getVideoTracks()[0].onended = () => this.stop();
        } catch (err) {
            console.error("Error starting broadcast:", err);
            alert("Failed to start screen share. Please check permissions.");
        }
    }

    setupUI() {
        const adminContent = document.getElementById('adminContent');
        adminContent.innerHTML = `
            <div class="monitor-container animate-fade-in">
                <div class="header" style="border:none;">
                    <h2>Monitoring: ${this.metadata.title}</h2>
                    <button class="btn btn-outline" id="stopBroadcasting">Stop Share</button>
                </div>
                <div class="life-live-player" id="adminPlayer">
                    <video id="adminPreview" class="video-element" autoplay muted></video>
                    <div id="adminLogoOverlay" class="channel-logo-overlay" style="width:${this.metadata.logoPos.width}px; left:${this.metadata.logoPos.x}%; top:${this.metadata.logoPos.y}%;">
                        <img src="${this.metadata.logo}" style="width:100%;">
                        <div class="resize-handle" id="resizeHandle"></div>
                    </div>
                </div>
                <div class="viewer-list card" style="margin-top:2rem;">
                    <h3>Live Viewers (<span id="broadcasterViewerCount">0</span>)</h3>
                    <ul id="viewersUl"></ul>
                </div>
            </div>
        `;

        document.getElementById('adminPreview').srcObject = this.stream;
        document.getElementById('stopBroadcasting').onclick = () => this.stop();

        this.setupLogoManipulation();
    }

    setupLogoManipulation() {
        const logo = document.getElementById('adminLogoOverlay');
        const handle = document.getElementById('resizeHandle');
        const player = document.getElementById('adminPlayer');
        let isDragging = false;
        let isResizing = false;
        let startX, startY, startLeft, startTop, startWidth;

        logo.onmousedown = (e) => {
            if (e.target === handle) {
                isResizing = true;
            } else {
                isDragging = true;
            }
            startX = e.clientX;
            startY = e.clientY;
            startLeft = logo.offsetLeft;
            startTop = logo.offsetTop;
            startWidth = logo.offsetWidth;
            document.onmousemove = onMouseMove;
            document.onmouseup = stopActions;
        };

        const onMouseMove = (e) => {
            if (isResizing) {
                const dx = e.clientX - startX;
                const newWidth = Math.max(50, startWidth + dx);
                logo.style.width = `${newWidth}px`;
                update(ref(db, `streams/${this.streamId}/metadata/logoPos`), { width: newWidth });
            } else if (isDragging) {
                const dx = e.clientX - startX;
                const dy = e.clientY - startY;

                let newX = ((startLeft + dx) / player.clientWidth) * 100;
                let newY = ((startTop + dy) / player.clientHeight) * 100;

                newX = Math.max(0, Math.min(90, newX));
                newY = Math.max(0, Math.min(90, newY));

                logo.style.left = `${newX}%`;
                logo.style.top = `${newY}%`;

                update(ref(db, `streams/${this.streamId}/metadata/logoPos`), { x: newX, y: newY });
            }
        };

        const stopActions = () => {
            isDragging = false;
            isResizing = false;
            document.onmousemove = null;
            document.onmouseup = null;
        };
    }

    listenForViewers() {
        onValue(ref(db, `streams/${this.streamId}/signaling`), (snapshot) => {
            const viewers = snapshot.val();
            if (!viewers) return;

            Object.keys(viewers).forEach(viewerId => {
                if (!this.peerConnections[viewerId]) {
                    this.createPeerConnection(viewerId);
                }
            });
        });

        // Presence / Viewer List
        onValue(ref(db, `streams/${this.streamId}/presence`), (snapshot) => {
            const list = snapshot.val() || {};
            const count = Object.keys(list).length;
            document.getElementById('broadcasterViewerCount').innerText = count;
            const ul = document.getElementById('viewersUl');
            ul.innerHTML = Object.values(list).map(v => `<li>IP: ${v.ip || 'Unknown'} - Joined: ${new Date(v.joinedAt).toLocaleTimeString()}</li>`).join('');
            update(ref(db, `streams/${this.streamId}/stats`), { viewerCount: count });
        });
    }

    async createPeerConnection(viewerId) {
        if (this.peerConnections[viewerId]) return;

        console.log(`Setting up PeerConnection for viewer: ${viewerId}`);
        const pc = new RTCPeerConnection({
            iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
        });

        this.peerConnections[viewerId] = pc;
        this.iceQueues[viewerId] = [];

        this.stream.getTracks().forEach(track => pc.addTrack(track, this.stream));

        pc.onicecandidate = (event) => {
            if (event.candidate) {
                push(ref(db, `streams/${this.streamId}/signaling/${viewerId}/iceCandidatesBroadcaster`), event.candidate.toJSON());
            }
        };

        pc.oniceconnectionstatechange = () => {
            console.log(`PC State [${viewerId}]: ${pc.iceConnectionState}`);
            if (pc.iceConnectionState === 'disconnected' || pc.iceConnectionState === 'failed') {
                this.closeViewerConnection(viewerId);
            }
        };

        // Handle Offer
        try {
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);

            await set(ref(db, `streams/${this.streamId}/signaling/${viewerId}/offer`), {
                sdp: offer.sdp,
                type: offer.type
            });
        } catch (e) {
            console.error("Error creating offer:", e);
        }

        // Listen for Answer
        onValue(ref(db, `streams/${this.streamId}/signaling/${viewerId}/answer`), async (snapshot) => {
            const answer = snapshot.val();
            if (answer && pc.signalingState !== 'stable') {
                try {
                    await pc.setRemoteDescription(new RTCSessionDescription(answer));
                    // Process queued ICE candidates
                    if (this.iceQueues[viewerId]) {
                        this.iceQueues[viewerId].forEach(cand => pc.addIceCandidate(new RTCIceCandidate(cand)).catch(e => console.error(e)));
                        this.iceQueues[viewerId] = [];
                    }
                } catch (e) { console.error("Error setting remote description:", e); }
            }
        });

        // Listen for ICE candidates from viewer
        onValue(ref(db, `streams/${this.streamId}/signaling/${viewerId}/iceCandidatesViewer`), (snapshot) => {
            snapshot.forEach(child => {
                const candidate = child.val();
                if (pc.remoteDescription && pc.remoteDescription.type) {
                    pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(e => console.error(e));
                } else {
                    this.iceQueues[viewerId].push(candidate);
                }
            });
        });
    }

    closeViewerConnection(viewerId) {
        if (this.peerConnections[viewerId]) {
            this.peerConnections[viewerId].close();
            delete this.peerConnections[viewerId];
            delete this.iceQueues[viewerId];
        }
    }

    stop() {
        if (this.stream) {
            this.stream.getTracks().forEach(track => track.stop());
        }
        Object.values(this.peerConnections).forEach(pc => pc.close());
        location.reload(); // Quick reset for admin dashboard
    }
}

async function startBroadcasting(streamId, metadata) {
    const broadcaster = new LifeLiveBroadcaster(streamId, metadata);
    activeBroadcasters[streamId] = broadcaster;
    await broadcaster.init();
}
