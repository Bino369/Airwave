// Connect to custom signaling server if specified, otherwise auto-detect local vs deployed backend URL
const SIGNALING_SERVER_URL = window.SIGNALING_SERVER_URL || (
  window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
    ? undefined // connects to same origin when running locally
    : 'https://airwave-8p40.onrender.com' // Deployed Render backend URL
);

const socket = SIGNALING_SERVER_URL ? io(SIGNALING_SERVER_URL) : io();

const ICE_SERVERS = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };

let pc = null;
let role = null; // 'host' | 'guest'
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

// Real-Time Stats loop
let statsInterval = null;
let lastBytesReceived = 0;
let lastTimestamp = 0;

// ---------- views switching ----------
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
  stopVisualizer();
  stopStatsLoop();
  stopDjMic();
  systemStream = null;
  document.getElementById('hostStats').classList.add('hidden');
  document.getElementById('guestStats').classList.add('hidden');
}

function stopDjMic() {
  if (micStream) {
    micStream.getTracks().forEach(t => t.stop());
    micStream = null;
  }
  if (mixAudioCtx) {
    mixAudioCtx.close();
    mixAudioCtx = null;
  }
  isMicActive = false;
  const btn = document.getElementById('btnToggleMic');
  const txt = document.getElementById('micStatusText');
  const wrap = document.getElementById('micVolumeWrap');
  if (btn) btn.classList.remove('active');
  if (txt) txt.textContent = 'Enable DJ Mic';
  if (wrap) wrap.classList.add('hidden');
}

// ---------- Real Audio Visualizer (Canvas) ----------
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
    console.warn('AudioContext visualizer initialization failed:', err);
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
    
    // Dynamic Gradient based on intensity
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

// ---------- Floating Emoji Reactions ----------
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
    if (roomCode) {
      socket.emit('reaction', { emoji });
    }
  });
});

socket.on('reaction', (data) => {
  if (data && data.emoji) {
    spawnEmoji(data.emoji);
  }
});

// ---------- Real-Time WebRTC Stats Loop ----------
function startStatsLoop() {
  stopStatsLoop();
  lastBytesReceived = 0;
  lastTimestamp = 0;

  statsInterval = setInterval(async () => {
    if (!pc) return;
    try {
      const stats = await pc.getStats();
      let rtt = null;
      let bitrate = null;

      stats.forEach(report => {
        if (report.type === 'candidate-pair' && report.currentRoundTripTime !== undefined) {
          rtt = Math.round(report.currentRoundTripTime * 1000);
        }
        if (report.type === 'inbound-rtp' && report.kind === 'audio') {
          if (lastBytesReceived && lastTimestamp) {
            const bytes = report.bytesReceived - lastBytesReceived;
            const time = (report.timestamp - lastTimestamp) / 1000;
            bitrate = Math.round((bytes * 8) / time / 1000);
          }
          lastBytesReceived = report.bytesReceived;
          lastTimestamp = report.timestamp;
        }
      });

      const text = `⚡ ${rtt !== null ? rtt + ' ms' : 'Live'}${bitrate !== null ? ' • ' + bitrate + ' kbps' : ''}`;
      
      const badgeId = role === 'host' ? 'hostStats' : 'guestStats';
      const badge = document.getElementById(badgeId);
      if (badge) {
        badge.textContent = text;
        badge.classList.remove('hidden');
      }
    } catch (e) {
      console.warn('Failed to fetch RTC stats:', e);
    }
  }, 2000);
}

function stopStatsLoop() {
  if (statsInterval) { clearInterval(statsInterval); statsInterval = null; }
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
    if (role === 'host') {
      const pill = document.getElementById('hostStatus');
      pill.textContent = connected ? 'Live' : 'Waiting for listener';
      pill.classList.toggle('live', connected);
    } else if (role === 'guest') {
      const pill = document.getElementById('guestStatus');
      pill.textContent = connected ? 'Streaming live' : 'Connecting';
      pill.classList.toggle('live', connected);
    }
    if (connected) {
      startStatsLoop();
    }
  };
  return conn;
}

// ---------- HOST flow ----------
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
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
      channelCount: 2,
      sampleRate: 48000
    } : true;

    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: audioConstraints
    });

    const audioTrack = stream.getAudioTracks()[0];
    if (!audioTrack) {
      stream.getTracks().forEach(t => t.stop());
      errEl.textContent = 'No audio track found. Please ensure "Share audio" was checked in the browser picker.';
      return;
    }

    systemStream = stream;

    // Start Audio Visualizer
    initAudioVisualizer(stream);

    // Don't transmit the video track over WebRTC to save bandwidth
    stream.getVideoTracks().forEach(vt => vt.stop());

    pc = createPeerConnection();
    pc.addTrack(audioTrack, stream);

    audioTrack.onended = () => {
      teardown();
      show('landing');
    };

    socket.emit('create-room', {}, (res) => {
      if (!res.ok) {
        errEl.textContent = 'Failed to create room. Try again.';
        return;
      }
      roomCode = res.roomCode;
      document.getElementById('roomCodeDisplay').textContent = roomCode;
      
      // Update QR Code
      const joinUrl = `${window.location.origin}${window.location.pathname}?room=${roomCode}`;
      const qrBox = document.getElementById('qrcode');
      qrBox.innerHTML = '';
      qrCodeObj = new QRCode(qrBox, {
        text: joinUrl,
        width: 160,
        height: 160
      });

      show('hostRoom');
    });

  } catch (err) {
    console.error('Capture error:', err);
    errEl.textContent = err.name === 'NotAllowedError'
      ? 'Sharing canceled.'
      : `Could not capture audio: ${err.message}`;
  }
});

// ---------- DJ MIC OVERLAY TOGGLE ----------
const btnToggleMic = document.getElementById('btnToggleMic');
const micVolumeSlider = document.getElementById('micVolumeSlider');

if (btnToggleMic) {
  btnToggleMic.addEventListener('click', async () => {
    if (!systemStream || !pc) return;

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
        const sender = pc.getSenders().find(s => s.track && s.track.kind === 'audio');
        if (sender) {
          sender.replaceTrack(mixedTrack);
        }

        isMicActive = true;
        btnToggleMic.classList.add('active');
        document.getElementById('micStatusText').textContent = 'DJ Mic ON (Live)';
        document.getElementById('micVolumeWrap').classList.remove('hidden');
      } catch (err) {
        console.error('Microphone error:', err);
        alert('Could not access microphone: ' + err.message);
      }
    } else {
      const originalTrack = systemStream.getAudioTracks()[0];
      const sender = pc.getSenders().find(s => s.track && s.track.kind === 'audio');
      if (sender && originalTrack) {
        sender.replaceTrack(originalTrack);
      }
      stopDjMic();
    }
  });
}

if (micVolumeSlider) {
  micVolumeSlider.addEventListener('input', (e) => {
    if (micGainNode) {
      micGainNode.gain.value = parseFloat(e.target.value);
    }
  });
}

// Toggle QR Box
document.getElementById('btnToggleQR').addEventListener('click', () => {
  const box = document.getElementById('qrBox');
  box.classList.toggle('hidden');
  document.getElementById('btnToggleQR').textContent = box.classList.contains('hidden') ? 'Show QR Code' : 'Hide QR Code';
});

// Copy Invite Link
document.getElementById('btnCopyLink').addEventListener('click', async () => {
  const link = `${window.location.origin}${window.location.pathname}?room=${roomCode}`;
  try {
    await navigator.clipboard.writeText(link);
    const btn = document.getElementById('btnCopyLink');
    btn.textContent = 'Copied link!';
    setTimeout(() => { btn.textContent = 'Copy invite link'; }, 2000);
  } catch (e) {
    console.error('Failed to copy:', e);
  }
});

// ---------- GUEST flow ----------
document.getElementById('btnGuest').addEventListener('click', () => {
  role = 'guest';
  document.getElementById('guestError').textContent = '';
  show('guestSetup');
});

const codeInput = document.getElementById('codeInput');
codeInput.addEventListener('input', () => {
  codeInput.value = codeInput.value.toUpperCase();
});

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
  const errEl = document.getElementById('guestError');
  errEl.textContent = '';

  socket.emit('join-room', { roomCode: code }, (res) => {
    if (!res.ok) {
      errEl.textContent = res.error || 'Could not join room.';
      show('guestSetup');
      return;
    }
    roomCode = code;
    document.getElementById('guestRoomLabel').textContent = code;
    document.getElementById('guestStatus').textContent = 'Connecting';
    document.getElementById('guestStatus').classList.remove('live');
    show('guestRoom');
  });
}

// Volume & Mute Controls
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

// ---------- WebRTC signaling events ----------
socket.on('peer-joined', async () => {
  if (role !== 'host') return;
  try {
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    socket.emit('signal', { signal: { type: 'sdp', sdp: pc.localDescription } });
  } catch (err) {
    console.error('Failed creating SDP offer:', err);
  }
});

socket.on('signal', async (signal) => {
  if (!signal) return;

  if (signal.type === 'sdp') {
    if (signal.sdp.type === 'offer') {
      if (role !== 'guest') return;
      pc = createPeerConnection();
      
      pc.ontrack = (e) => {
        remoteAudio.srcObject = e.streams[0];
        initAudioVisualizer(e.streams[0]);
      };

      await pc.setRemoteDescription(new RTCSessionDescription(signal.sdp));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      socket.emit('signal', { signal: { type: 'sdp', sdp: pc.localDescription } });
    } else if (signal.sdp.type === 'answer') {
      if (role !== 'host' || !pc) return;
      await pc.setRemoteDescription(new RTCSessionDescription(signal.sdp));
    }
  } else if (signal.type === 'ice') {
    if (!pc) return;
    try {
      await pc.addIceCandidate(new RTCIceCandidate(signal.candidate));
    } catch (err) {
      console.error('Error adding ICE candidate:', err);
    }
  }
});

socket.on('peer-left', () => {
  teardown();
  if (role === 'guest') {
    document.getElementById('guestError').textContent = 'The host has ended the room.';
    show('guestSetup');
  } else if (role === 'host') {
    const pill = document.getElementById('hostStatus');
    pill.textContent = 'Waiting for listener';
    pill.classList.remove('live');
  }
});

// ---------- Auto-Join from URL (`?room=ABCDE`) ----------
window.addEventListener('DOMContentLoaded', () => {
  const urlParams = new URLSearchParams(window.location.search);
  const roomParam = urlParams.get('room') || urlParams.get('code');
  if (roomParam && roomParam.length === 5) {
    codeInput.value = roomParam.toUpperCase();
    joinRoomWithCode(roomParam.toUpperCase());
  }
});
