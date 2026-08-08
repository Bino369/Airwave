// Airwave — 100% Vercel WebRTC Cloud Signaling via PeerJS

const ICE_SERVERS = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:stun3.l.google.com:19302' },
    { urls: 'stun:stun4.l.google.com:19302' },
    { urls: 'stun:global.stun.twilio.com:3478' },
    {
      urls: [
        'turn:openrelay.metered.ca:80',
        'turn:openrelay.metered.ca:80?transport=udp',
        'turn:openrelay.metered.ca:443',
        'turn:openrelay.metered.ca:443?transport=tcp',
        'turns:openrelay.metered.ca:443?transport=tcp'
      ],
      username: 'openrelay',
      credential: 'openrelay'
    }
  ]
};

const PEER_PREFIX = 'airwave-v3-';

let peer = null;
let activeMediaConn = null;
let activeDataConn = null;
let role = null;
let roomCode = null;
let qrCodeObj = null;

// Web Audio API Visualizer state
let audioCtx = null;
let analyserNode = null;
let visualizerAnimFrame = null;

// DJ Mic Overlay state
let systemStream = null;
let micStream = null;
let mixAudioCtx = null;
let micGainNode = null;
let isMicActive = false;

// Stats loop
let statsInterval = null;
let lastBytesReceived = 0;
let lastTimestamp = 0;

// ---------- Views ----------
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
  btn.addEventListener('click', () => { teardown(); show('landing'); });
});

function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 5 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

function teardown() {
  if (activeMediaConn) { try { activeMediaConn.close(); } catch(e){} activeMediaConn = null; }
  if (activeDataConn) { try { activeDataConn.close(); } catch(e){} activeDataConn = null; }
  if (peer) { try { peer.destroy(); } catch(e){} peer = null; }
  stopVisualizer();
  stopStatsLoop();
  stopDjMic();
  systemStream = null;
  document.getElementById('hostStats').classList.add('hidden');
  document.getElementById('guestStats').classList.add('hidden');
}

function stopDjMic() {
  if (micStream) { micStream.getTracks().forEach(t => t.stop()); micStream = null; }
  if (mixAudioCtx) { mixAudioCtx.close(); mixAudioCtx = null; }
  isMicActive = false;
  const btn = document.getElementById('btnToggleMic');
  const txt = document.getElementById('micStatusText');
  const wrap = document.getElementById('micVolumeWrap');
  if (btn) btn.classList.remove('active');
  if (txt) txt.textContent = 'Enable DJ Mic';
  if (wrap) wrap.classList.add('hidden');
}

// ---------- Visualizer ----------
const canvas = document.getElementById('visualizerCanvas');
const canvasCtx = canvas ? canvas.getContext('2d') : null;

function resizeCanvas() {
  if (!canvas) return;
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

function initAudioVisualizer(stream) {
  try {
    stopVisualizer();
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const source = audioCtx.createMediaStreamSource(stream);
    analyserNode = audioCtx.createAnalyser();
    analyserNode.fftSize = 128;
    source.connect(analyserNode);
    document.querySelector('.visualizer-container').classList.add('active');
    drawVisualizer();
  } catch (err) {
    console.warn('Visualizer init failed:', err);
  }
}

function drawVisualizer() {
  if (!analyserNode || !canvasCtx) return;
  visualizerAnimFrame = requestAnimationFrame(drawVisualizer);
  const bufferLength = analyserNode.frequencyBinCount;
  const dataArray = new Uint8Array(bufferLength);
  analyserNode.getByteFrequencyData(dataArray);
  canvasCtx.clearRect(0, 0, canvas.width, canvas.height);
  const barWidth = (canvas.width / bufferLength) * 2;
  let x = 0;
  for (let i = 0; i < bufferLength; i++) {
    const barHeight = (dataArray[i] / 255) * (canvas.height * 0.4);
    const gradient = canvasCtx.createLinearGradient(0, canvas.height, 0, canvas.height - barHeight);
    gradient.addColorStop(0, 'rgba(255, 93, 58, 0.2)');
    gradient.addColorStop(0.5, 'rgba(255, 93, 58, 0.7)');
    gradient.addColorStop(1, 'rgba(51, 214, 166, 1)');
    canvasCtx.fillStyle = gradient;
    canvasCtx.fillRect(x, canvas.height - barHeight, barWidth - 2, barHeight);
    x += barWidth;
  }
}

function stopVisualizer() {
  if (visualizerAnimFrame) cancelAnimationFrame(visualizerAnimFrame);
  if (audioCtx) { audioCtx.close(); audioCtx = null; }
  analyserNode = null;
  if (canvasCtx) canvasCtx.clearRect(0, 0, canvas.width, canvas.height);
  document.querySelector('.visualizer-container').classList.remove('active');
}

// ---------- Emoji Reactions ----------
function spawnEmoji(emoji) {
  const container = document.getElementById('emojiOverlay');
  if (!container) return;
  const el = document.createElement('div');
  el.className = 'floating-emoji';
  el.textContent = emoji;
  el.style.left = `${Math.random() * 80 + 10}vw`;
  container.appendChild(el);
  setTimeout(() => el.remove(), 2600);
}

document.querySelectorAll('.emoji-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const emoji = btn.getAttribute('data-emoji');
    spawnEmoji(emoji);
    if (activeDataConn && activeDataConn.open) {
      activeDataConn.send({ type: 'reaction', emoji });
    }
  });
});

// ---------- Stats Loop ----------
function startStatsLoop(mediaConn) {
  stopStatsLoop();
  lastBytesReceived = 0;
  lastTimestamp = 0;
  statsInterval = setInterval(async () => {
    if (!mediaConn || !mediaConn.peerConnection) return;
    try {
      const stats = await mediaConn.peerConnection.getStats();
      let rtt = null, bitrate = null;
      stats.forEach(report => {
        if (report.type === 'candidate-pair' && report.currentRoundTripTime !== undefined) rtt = Math.round(report.currentRoundTripTime * 1000);
        if (report.type === 'inbound-rtp' && report.kind === 'audio') {
          if (lastBytesReceived && lastTimestamp) {
            bitrate = Math.round(((report.bytesReceived - lastBytesReceived) * 8) / ((report.timestamp - lastTimestamp) / 1000) / 1000);
          }
          lastBytesReceived = report.bytesReceived;
          lastTimestamp = report.timestamp;
        }
      });
      const text = `⚡ ${rtt !== null ? rtt + ' ms' : 'Live'}${bitrate !== null ? ' • ' + bitrate + ' kbps' : ''}`;
      const badge = document.getElementById(role === 'host' ? 'hostStats' : 'guestStats');
      if (badge) { badge.textContent = text; badge.classList.remove('hidden'); }
    } catch (e) { console.warn('Stats error:', e); }
  }, 2000);
}

function stopStatsLoop() {
  if (statsInterval) { clearInterval(statsInterval); statsInterval = null; }
}

// ---------- iOS/Mobile Safe Audio Playback ----------
function playRemoteAudio(remoteStream) {
  const remoteAudio = document.getElementById('remoteAudio');
  const btnUnmuteIos = document.getElementById('btnUnmuteIos');
  if (!remoteAudio) return;
  remoteAudio.srcObject = remoteStream;
  initAudioVisualizer(remoteStream);
  remoteAudio.play().then(() => {
    if (btnUnmuteIos) btnUnmuteIos.classList.add('hidden');
  }).catch(() => {
    if (btnUnmuteIos) {
      btnUnmuteIos.classList.remove('hidden');
      btnUnmuteIos.onclick = () => {
        remoteAudio.play().catch(e => console.error(e));
        if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
        btnUnmuteIos.classList.add('hidden');
      };
    }
  });
}

// =====================================================================
// HOST FLOW
// The host registers on PeerJS cloud with a known ID = PEER_PREFIX + roomCode
// When a guest connects (via data channel), the HOST calls the GUEST with the audio stream.
// Guest answers with nothing — receives the stream one-way.
// =====================================================================
document.getElementById('btnHost').addEventListener('click', () => {
  role = 'host';
  document.getElementById('hostError').textContent = '';
  show('hostSetup');
});

document.getElementById('btnCaptureAudio').addEventListener('click', async () => {
  const errEl = document.getElementById('hostError');
  errEl.textContent = '';
  const isMusicMode = document.getElementById('chkMusicMode').checked;

  try {
    const audioConstraints = isMusicMode ? {
      echoCancellation: false, noiseSuppression: false, autoGainControl: false,
      channelCount: 2, sampleRate: 48000
    } : true;

    const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: audioConstraints });
    const audioTrack = stream.getAudioTracks()[0];
    if (!audioTrack) {
      stream.getTracks().forEach(t => t.stop());
      errEl.textContent = 'No audio track found. Make sure to check "Share audio" in the browser dialog.';
      return;
    }

    systemStream = stream;
    initAudioVisualizer(stream);
    stream.getVideoTracks().forEach(vt => vt.stop());
    audioTrack.onended = () => { teardown(); show('landing'); };

    roomCode = generateRoomCode();
    const hostPeerId = PEER_PREFIX + roomCode;
    peer = new Peer(hostPeerId, { config: ICE_SERVERS, debug: 1 });

    peer.on('open', (id) => {
      console.log('HOST registered on PeerJS cloud:', id);
      document.getElementById('roomCodeDisplay').textContent = roomCode;

      const joinUrl = `${window.location.origin}${window.location.pathname}?room=${roomCode}`;
      const qrBox = document.getElementById('qrcode');
      qrBox.innerHTML = '';
      qrCodeObj = new QRCode(qrBox, { text: joinUrl, width: 160, height: 160 });
      show('hostRoom');
    });

    peer.on('error', (err) => {
      console.error('Host peer error:', err);
      if (err.type === 'unavailable-id') {
        roomCode = generateRoomCode();
        peer = new Peer(PEER_PREFIX + roomCode, { config: ICE_SERVERS });
      } else {
        errEl.textContent = `Connection error: ${err.message}`;
      }
    });

    // When guest opens data connection → HOST calls GUEST back with audio stream
    peer.on('connection', (dataConn) => {
      console.log('Guest joined via data channel:', dataConn.peer);
      activeDataConn = dataConn;

      dataConn.on('data', (data) => {
        if (data && data.type === 'reaction' && data.emoji) spawnEmoji(data.emoji);
      });

      // Host calls guest — one-way: host sends stream, guest receives
      const mediaConn = peer.call(dataConn.peer, systemStream);
      activeMediaConn = mediaConn;

      const pill = document.getElementById('hostStatus');
      pill.textContent = 'Live';
      pill.classList.add('live');
      startStatsLoop(mediaConn);

      if (mediaConn.peerConnection) {
        mediaConn.peerConnection.onconnectionstatechange = () => {
          const state = mediaConn.peerConnection.connectionState;
          if (state === 'connected') { pill.textContent = 'Live'; pill.classList.add('live'); }
          else if (state === 'disconnected' || state === 'failed') { pill.textContent = 'Waiting for listener'; pill.classList.remove('live'); }
        };
      }

      mediaConn.on('close', () => {
        pill.textContent = 'Waiting for listener';
        pill.classList.remove('live');
      });
    });

  } catch (err) {
    console.error('Capture error:', err);
    errEl.textContent = err.name === 'NotAllowedError' ? 'Sharing canceled.' : `Could not capture audio: ${err.message}`;
  }
});

// ---------- DJ Mic ----------
const btnToggleMic = document.getElementById('btnToggleMic');
const micVolumeSlider = document.getElementById('micVolumeSlider');

if (btnToggleMic) {
  btnToggleMic.addEventListener('click', async () => {
    if (!systemStream || !activeMediaConn) return;
    if (!isMicActive) {
      try {
        micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        mixAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const systemSource = mixAudioCtx.createMediaStreamSource(systemStream);
        const micSource = mixAudioCtx.createMediaStreamSource(micStream);
        micGainNode = mixAudioCtx.createGain();
        micGainNode.gain.value = parseFloat(micVolumeSlider ? micVolumeSlider.value : 1);
        const dest = mixAudioCtx.createMediaStreamDestination();
        systemSource.connect(dest);
        micSource.connect(micGainNode);
        micGainNode.connect(dest);
        const mixedTrack = dest.stream.getAudioTracks()[0];
        if (activeMediaConn.peerConnection) {
          const sender = activeMediaConn.peerConnection.getSenders().find(s => s.track && s.track.kind === 'audio');
          if (sender) sender.replaceTrack(mixedTrack);
        }
        isMicActive = true;
        btnToggleMic.classList.add('active');
        document.getElementById('micStatusText').textContent = 'DJ Mic ON (Live)';
        document.getElementById('micVolumeWrap').classList.remove('hidden');
      } catch (err) {
        alert('Could not access microphone: ' + err.message);
      }
    } else {
      const originalTrack = systemStream.getAudioTracks()[0];
      if (activeMediaConn.peerConnection && originalTrack) {
        const sender = activeMediaConn.peerConnection.getSenders().find(s => s.track && s.track.kind === 'audio');
        if (sender) sender.replaceTrack(originalTrack);
      }
      stopDjMic();
    }
  });
}

if (micVolumeSlider) {
  micVolumeSlider.addEventListener('input', (e) => {
    if (micGainNode) micGainNode.gain.value = parseFloat(e.target.value);
  });
}

document.getElementById('btnToggleQR').addEventListener('click', () => {
  const box = document.getElementById('qrBox');
  box.classList.toggle('hidden');
  document.getElementById('btnToggleQR').textContent = box.classList.contains('hidden') ? 'Show QR Code' : 'Hide QR Code';
});

document.getElementById('btnCopyLink').addEventListener('click', async () => {
  const link = `${window.location.origin}${window.location.pathname}?room=${roomCode}`;
  try {
    await navigator.clipboard.writeText(link);
    const btn = document.getElementById('btnCopyLink');
    btn.textContent = 'Copied link!';
    setTimeout(() => { btn.textContent = 'Copy invite link'; }, 2000);
  } catch (e) { console.error('Failed to copy:', e); }
});

// =====================================================================
// GUEST FLOW
// Guest creates an anonymous PeerJS peer, then opens a DATA connection to the host.
// The host sees this and calls the guest back with the audio stream.
// Guest listens for incoming 'call' event and answers with no stream.
// =====================================================================
document.getElementById('btnGuest').addEventListener('click', () => {
  role = 'guest';
  document.getElementById('guestError').textContent = '';
  show('guestSetup');
});

const codeInput = document.getElementById('codeInput');
codeInput.addEventListener('input', () => { codeInput.value = codeInput.value.toUpperCase(); });

document.getElementById('btnJoin').addEventListener('click', () => {
  const code = codeInput.value.trim();
  if (code.length !== 5) {
    document.getElementById('guestError').textContent = 'Enter a valid 5-character code.';
    return;
  }
  joinRoomWithCode(code);
});

function joinRoomWithCode(code) {
  role = 'guest';
  roomCode = code;
  const errEl = document.getElementById('guestError');
  errEl.textContent = '';

  document.getElementById('guestRoomLabel').textContent = code;
  document.getElementById('guestStatus').textContent = 'Connecting...';
  document.getElementById('guestStatus').classList.remove('live');
  show('guestRoom');

  // Guest creates an anonymous PeerJS peer (no fixed ID)
  peer = new Peer({ config: ICE_SERVERS, debug: 1 });

  peer.on('open', (myId) => {
    console.log('GUEST peer ready, my ID:', myId);
    const hostPeerId = PEER_PREFIX + code;

    // Step 1: Open data channel to host — this signals our presence
    const dataConn = peer.connect(hostPeerId, { reliable: true });
    activeDataConn = dataConn;

    dataConn.on('open', () => {
      console.log('Data channel open to host. Waiting for host to call back...');
      document.getElementById('guestStatus').textContent = 'Waiting for stream...';
    });

    dataConn.on('data', (data) => {
      if (data && data.type === 'reaction' && data.emoji) spawnEmoji(data.emoji);
    });

    dataConn.on('error', (err) => {
      console.error('Data conn error:', err);
      errEl.textContent = 'Room not found. Check the code and try again.';
      show('guestSetup');
    });
  });

  // Step 2: Host will call us — answer and receive stream
  peer.on('call', (call) => {
    console.log('HOST is calling us with audio stream!');
    activeMediaConn = call;
    call.answer(); // No stream from guest side — receive only

    call.on('stream', (remoteStream) => {
      console.log('Got remote audio stream!');
      playRemoteAudio(remoteStream);
      const pill = document.getElementById('guestStatus');
      pill.textContent = 'Streaming live';
      pill.classList.add('live');
      startStatsLoop(call);
    });

    if (call.peerConnection) {
      call.peerConnection.onconnectionstatechange = () => {
        const state = call.peerConnection.connectionState;
        console.log('Connection state:', state);
        const pill = document.getElementById('guestStatus');
        if (state === 'connected') { pill.textContent = 'Streaming live'; pill.classList.add('live'); }
        else if (state === 'failed') { pill.textContent = 'Connection failed. Try rejoining.'; pill.classList.remove('live'); }
      };
    }

    call.on('close', () => {
      document.getElementById('guestStatus').textContent = 'Host disconnected';
      document.getElementById('guestStatus').classList.remove('live');
    });
  });

  peer.on('error', (err) => {
    console.error('Guest peer error:', err);
    if (err.type === 'peer-unavailable') {
      errEl.textContent = 'Room not found. Please check the code and try again.';
      show('guestSetup');
    } else {
      document.getElementById('guestStatus').textContent = `Error: ${err.message}`;
    }
  });
}

// ---------- Volume & Mute Controls ----------
const remoteAudio = document.getElementById('remoteAudio');
const volumeSlider = document.getElementById('volumeSlider');
const btnMute = document.getElementById('btnMute');
const volumePercent = document.getElementById('volumePercent');

if (volumeSlider && remoteAudio) {
  volumeSlider.addEventListener('input', (e) => {
    const val = parseFloat(e.target.value);
    remoteAudio.volume = val;
    remoteAudio.muted = val === 0;
    btnMute.textContent = val === 0 ? '🔇' : '🔊';
    volumePercent.textContent = `${Math.round(val * 100)}%`;
  });
}

if (btnMute && remoteAudio) {
  btnMute.addEventListener('click', () => {
    remoteAudio.muted = !remoteAudio.muted;
    btnMute.textContent = remoteAudio.muted ? '🔇' : '🔊';
    if (volumeSlider) {
      volumeSlider.value = remoteAudio.muted ? 0 : remoteAudio.volume;
      volumePercent.textContent = remoteAudio.muted ? '0%' : `${Math.round(remoteAudio.volume * 100)}%`;
    }
  });
}

// ---------- Auto-Join from URL ----------
window.addEventListener('DOMContentLoaded', () => {
  const urlParams = new URLSearchParams(window.location.search);
  const roomParam = urlParams.get('room') || urlParams.get('code');
  if (roomParam && roomParam.length === 5) {
    codeInput.value = roomParam.toUpperCase();
    joinRoomWithCode(roomParam.toUpperCase());
  }
});
