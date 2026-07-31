// Connect to custom signaling server if specified, otherwise auto-detect local vs deployed backend URL
const SIGNALING_SERVER_URL = window.SIGNALING_SERVER_URL || (
  window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
    ? undefined // connects to same origin when running locally
    : 'https://YOUR-RENDER-APP-NAME.onrender.com' // Replace with your deployed Render/Railway backend URL
);

const socket = SIGNALING_SERVER_URL ? io(SIGNALING_SERVER_URL) : io();

const ICE_SERVERS = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };

let pc = null;
let role = null; // 'host' | 'guest'
let roomCode = null;

// ---------- ambient frequency strip ----------
const freqStrip = document.getElementById('freqStrip');
for (let i = 0; i < 48; i++) {
  const bar = document.createElement('div');
  bar.className = 'freq-bar';
  bar.style.animationDelay = `${(Math.random() * 1.6).toFixed(2)}s`;
  bar.style.animationDuration = `${(1.2 + Math.random() * 1.2).toFixed(2)}s`;
  freqStrip.appendChild(bar);
}
function setLive(isLive) {
  freqStrip.classList.toggle('live', isLive);
}

// ---------- view switching ----------
const views = {
  landing: document.getElementById('view-landing'),
  hostSetup: document.getElementById('view-host-setup'),
  hostRoom: document.getElementById('view-host-room'),
  guestSetup: document.getElementById('view-guest-setup'),
  guestRoom: document.getElementById('view-guest-room'),
};
function show(name) {
  Object.values(views).forEach(v => v.classList.add('hidden'));
  views[name].classList.remove('hidden');
}
document.querySelectorAll('[data-back]').forEach(btn => {
  btn.addEventListener('click', () => {
    teardown();
    show('landing');
  });
});

function teardown() {
  if (pc) { pc.close(); pc = null; }
  setLive(false);
}

// ---------- shared peer connection setup ----------
function createPeerConnection() {
  const conn = new RTCPeerConnection(ICE_SERVERS);
  conn.onicecandidate = (e) => {
    if (e.candidate) {
      socket.emit('signal', { signal: { type: 'ice', candidate: e.candidate } });
    }
  };
  conn.onconnectionstatechange = () => {
    const connected = conn.connectionState === 'connected';
    setLive(connected);
    if (role === 'host') {
      const pill = document.getElementById('hostStatus');
      pill.textContent = connected ? 'Live' : 'Waiting for listener';
      pill.classList.toggle('live', connected);
    } else if (role === 'guest') {
      const pill = document.getElementById('guestStatus');
      pill.textContent = connected ? 'Live' : 'Connecting';
      pill.classList.toggle('live', connected);
    }
  };
  return conn;
}

// =========================================================
// HOST FLOW
// =========================================================
document.getElementById('btnHost').addEventListener('click', () => {
  role = 'host';
  show('hostSetup');
});

let capturedStream = null;

document.getElementById('btnCaptureAudio').addEventListener('click', async () => {
  const errEl = document.getElementById('hostError');
  errEl.textContent = '';
  try {
    // video:true is required by most browsers to allow tab/system audio capture
    capturedStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
  } catch (err) {
    errEl.textContent = "Couldn't capture audio — you may have cancelled the picker, or need to tick 'share audio'.";
    return;
  }

  const audioTracks = capturedStream.getAudioTracks();
  if (audioTracks.length === 0) {
    errEl.textContent = "No audio track was shared. Re-open the picker and tick 'share audio'.";
    capturedStream.getTracks().forEach(t => t.stop());
    return;
  }
  // We only need audio — drop the video track locally to save resources.
  capturedStream.getVideoTracks().forEach(t => t.stop());

  socket.emit('create-room', {}, (res) => {
    if (!res.ok) {
      errEl.textContent = 'Could not create a room. Try again.';
      return;
    }
    roomCode = res.roomCode;
    document.getElementById('roomCodeDisplay').textContent = roomCode;
    show('hostRoom');
  });
});

document.getElementById('btnCopyLink').addEventListener('click', async () => {
  const url = `${location.origin}${location.pathname}?join=${roomCode}`;
  try {
    await navigator.clipboard.writeText(url);
    const btn = document.getElementById('btnCopyLink');
    const original = btn.textContent;
    btn.textContent = 'Copied!';
    setTimeout(() => { btn.textContent = original; }, 1500);
  } catch {
    // clipboard may be unavailable; fall back silently
  }
});

// Guest joined -> host makes the offer
socket.on('peer-joined', async () => {
  pc = createPeerConnection();
  capturedStream.getAudioTracks().forEach(track => pc.addTrack(track, capturedStream));

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  socket.emit('signal', { signal: { type: 'offer', sdp: offer } });
});

// =========================================================
// GUEST FLOW
// =========================================================
document.getElementById('btnGuest').addEventListener('click', () => {
  role = 'guest';
  show('guestSetup');
  document.getElementById('codeInput').focus();
});

const codeInput = document.getElementById('codeInput');
codeInput.addEventListener('input', () => {
  codeInput.value = codeInput.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
});
codeInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') document.getElementById('btnJoin').click();
});

document.getElementById('btnJoin').addEventListener('click', () => {
  const code = codeInput.value.trim();
  const errEl = document.getElementById('guestError');
  errEl.textContent = '';
  if (code.length < 5) {
    errEl.textContent = 'Enter the full 5-character code.';
    return;
  }
  socket.emit('join-room', { roomCode: code }, (res) => {
    if (!res.ok) {
      errEl.textContent = res.error;
      return;
    }
    roomCode = res.roomCode;
    document.getElementById('guestRoomLabel').textContent = roomCode;
    pc = createPeerConnection();
    pc.ontrack = (e) => {
      const audioEl = document.getElementById('remoteAudio');
      audioEl.srcObject = e.streams[0];
      document.getElementById('guestHint').textContent = 'Audio connected.';
    };
    show('guestRoom');
  });
});

// Pre-fill room code from an invite link like ?join=ABCDE
const params = new URLSearchParams(location.search);
if (params.get('join')) {
  document.getElementById('btnGuest').click();
  codeInput.value = params.get('join').toUpperCase();
}

// =========================================================
// SHARED SIGNALING HANDLER
// =========================================================
socket.on('signal', async (signal) => {
  if (!pc) return;
  if (signal.type === 'offer') {
    await pc.setRemoteDescription(new RTCSessionDescription(signal.sdp));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    socket.emit('signal', { signal: { type: 'answer', sdp: answer } });
  } else if (signal.type === 'answer') {
    await pc.setRemoteDescription(new RTCSessionDescription(signal.sdp));
  } else if (signal.type === 'ice') {
    try {
      await pc.addIceCandidate(new RTCIceCandidate(signal.candidate));
    } catch (err) {
      console.warn('Failed to add ICE candidate', err);
    }
  }
});

socket.on('peer-left', () => {
  teardown();
  if (role === 'host') {
    document.getElementById('hostStatus').textContent = 'Waiting for listener';
    document.getElementById('hostStatus').classList.remove('live');
  } else if (role === 'guest') {
    document.getElementById('guestStatus').textContent = 'Listener left. Room closed.';
  }
});
