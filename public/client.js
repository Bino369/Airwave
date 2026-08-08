// Airwave — 100% Vercel WebRTC Cloud Signaling via PeerJS

const ICE_SERVERS = {
  iceServers: [
    // Multi-Region Public STUN Servers
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:stun3.l.google.com:19302' },
    { urls: 'stun:stun4.l.google.com:19302' },
    { urls: 'stun:global.stun.twilio.com:3478' },
    { urls: 'stun:stun.services.mozilla.com' },
    // Free TURN Relay Servers (Metered OpenRelay - 100% cross-network NAT & firewall traversal)
    {
      urls: [
        'turn:openrelay.metered.ca:80',
        'turn:openrelay.metered.ca:443',
        'turn:openrelay.metered.ca:443?transport=tcp',
        'turns:openrelay.metered.ca:443?transport=tcp'
      ],
      username: 'openrelay',
      credential: 'openrelay'
    }
  ]
};

const PEER_PREFIX = 'airwave-room-';

let peer = null;
let activeMediaConn = null;
let activeDataConn = null;
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

// ---------- Views Switching ----------
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

function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 5 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

function teardown() {
  if (activeMediaConn) { activeMediaConn.close(); activeMediaConn = null; }
  if (activeDataConn) { activeDataConn.close(); activeDataConn = null; }
  if (peer) { peer.destroy(); peer = null; }
  
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
    if (activeDataConn && activeDataConn.open) {
      activeDataConn.send({ type: 'reaction', emoji });
    }
  });
});

// ---------- Real-Time WebRTC Stats Loop ----------
function startStatsLoop(mediaConn) {
  stopStatsLoop();
  lastBytesReceived = 0;
  lastTimestamp = 0;

  statsInterval = setInterval(async () => {
    if (!mediaConn || !mediaConn.peerConnection) return;
    try {
      const stats = await mediaConn.peerConnection.getStats();
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

// ---------- HOST FLOW (Sender) ----------
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
      errEl.textContent = 'No audio track found. Make sure to check "Share audio" in the browser dialog.';
      return;
    }

    systemStream = stream;

    // Start Audio Visualizer locally
    initAudioVisualizer(stream);

    // Stop video track to save bandwidth
    stream.getVideoTracks().forEach(vt => vt.stop());

    audioTrack.onended = () => {
      teardown();
      show('landing');
    };

    // Initialize Host PeerJS Node
    roomCode = generateRoomCode();
    const peerId = PEER_PREFIX + roomCode;

    peer = new Peer(peerId, { config: ICE_SERVERS, debug: 1 });

    peer.on('open', (id) => {
      console.log('Host Peer registered with ID:', id);
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

    peer.on('error', (err) => {
      console.error('Host Peer Error:', err);
      if (err.type === 'unavailable-id') {
        // Retry code generation if room code collision
        roomCode = generateRoomCode();
        peer = new Peer(PEER_PREFIX + roomCode, { config: ICE_SERVERS });
      } else {
        errEl.textContent = `P2P Error: ${err.message}`;
      }
    });

    // Listen for guest data connections (reactions & handshakes)
    peer.on('connection', (dataConn) => {
      activeDataConn = dataConn;
      console.log('Guest connected data channel:', dataConn.peer);

      dataConn.on('data', (data) => {
        if (data && data.type === 'reaction' && data.emoji) {
          spawnEmoji(data.emoji);
        }
      });

      // Call guest back with system audio stream
      const mediaConn = peer.call(dataConn.peer, systemStream);
      activeMediaConn = mediaConn;

      mediaConn.on('stream', () => {
        const pill = document.getElementById('hostStatus');
        pill.textContent = 'Live';
        pill.classList.add('live');
        startStatsLoop(mediaConn);
      });

      if (mediaConn.peerConnection) {
        mediaConn.peerConnection.onconnectionstatechange = () => {
          const connected = mediaConn.peerConnection.connectionState === 'connected';
          const pill = document.getElementById('hostStatus');
          pill.textContent = connected ? 'Live' : 'Waiting for listener';
          pill.classList.toggle('live', connected);
          if (connected) startStatsLoop(mediaConn);
        };
      } else {
        const pill = document.getElementById('hostStatus');
        pill.textContent = 'Live';
        pill.classList.add('live');
        startStatsLoop(mediaConn);
      }

      mediaConn.on('close', () => {
        const pill = document.getElementById('hostStatus');
        pill.textContent = 'Waiting for listener';
        pill.classList.remove('live');
      });
    });

    // Listen for direct incoming calls
    peer.on('call', (call) => {
      activeMediaConn = call;
      call.answer(systemStream);
      
      const pill = document.getElementById('hostStatus');
      pill.textContent = 'Live';
      pill.classList.add('live');
      startStatsLoop(call);
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
        console.error('Microphone error:', err);
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

// ---------- GUEST FLOW (Listener) ----------
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

function playRemoteAudio(remoteStream) {
  const remoteAudio = document.getElementById('remoteAudio');
  const btnUnmuteIos = document.getElementById('btnUnmuteIos');
  if (!remoteAudio) return;

  remoteAudio.srcObject = remoteStream;
  initAudioVisualizer(remoteStream);

  const attemptPlay = () => {
    remoteAudio.play().then(() => {
      if (btnUnmuteIos) btnUnmuteIos.classList.add('hidden');
    }).catch((err) => {
      console.warn('Autoplay blocked on iOS/Mobile Safari:', err);
      if (btnUnmuteIos) {
        btnUnmuteIos.classList.remove('hidden');
        btnUnmuteIos.onclick = () => {
          remoteAudio.play().then(() => {
            btnUnmuteIos.classList.add('hidden');
          }).catch(e => console.error(e));
          if (audioCtx && audioCtx.state === 'suspended') {
            audioCtx.resume();
          }
        };
      }
    });
  };

  attemptPlay();
}

function joinRoomWithCode(code) {
  role = 'guest';
  roomCode = code;
  const errEl = document.getElementById('guestError');
  errEl.textContent = '';

  document.getElementById('guestRoomLabel').textContent = code;
  document.getElementById('guestStatus').textContent = 'Connecting across networks...';
  document.getElementById('guestStatus').classList.remove('live');
  show('guestRoom');

  peer = new Peer({ config: ICE_SERVERS, debug: 1 });

  peer.on('open', (id) => {
    console.log('Guest Peer initialized with ID:', id);
    const targetPeerId = PEER_PREFIX + code;

    // Connect Data Channel for reactions
    const dataConn = peer.connect(targetPeerId);
    activeDataConn = dataConn;

    dataConn.on('open', () => {
      console.log('Data channel connected to host:', targetPeerId);
    });

    dataConn.on('data', (data) => {
      if (data && data.type === 'reaction' && data.emoji) {
        spawnEmoji(data.emoji);
      }
    });

    // Call host or wait for host media call
    const call = peer.call(targetPeerId, createDummyAudioStream());
    activeMediaConn = call;

    call.on('stream', (remoteStream) => {
      console.log('Receiving live audio stream from host');
      playRemoteAudio(remoteStream);

      const pill = document.getElementById('guestStatus');
      pill.textContent = 'Streaming live';
      pill.classList.add('live');
      startStatsLoop(call);
    });

    if (call.peerConnection) {
      call.peerConnection.onconnectionstatechange = () => {
        const state = call.peerConnection.connectionState;
        console.log('Guest peer connection state:', state);
        const pill = document.getElementById('guestStatus');
        if (state === 'connected' || state === 'completed') {
          pill.textContent = 'Streaming live';
          pill.classList.add('live');
          startStatsLoop(call);
        } else if (state === 'failed') {
          pill.textContent = 'Retrying connection...';
          pill.classList.remove('live');
        }
      };
    }

    call.on('close', () => {
      const pill = document.getElementById('guestStatus');
      pill.textContent = 'Host disconnected';
      pill.classList.remove('live');
    });
  });

  peer.on('call', (call) => {
    activeMediaConn = call;
    call.answer();

    call.on('stream', (remoteStream) => {
      playRemoteAudio(remoteStream);

      const pill = document.getElementById('guestStatus');
      pill.textContent = 'Streaming live';
      pill.classList.add('live');
      startStatsLoop(call);
    });
  });

  peer.on('error', (err) => {
    console.error('Guest Peer Error:', err);
    if (err.type === 'peer-unavailable') {
      errEl.textContent = 'Room not found. Please check the 5-character code and try again.';
      show('guestSetup');
    } else {
      document.getElementById('guestStatus').textContent = 'Connection error';
    }
  });
}

function createDummyAudioStream() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const dst = ctx.createMediaStreamDestination();
    osc.connect(dst);
    osc.start();
    const track = dst.stream.getAudioTracks()[0];
    track.enabled = false; // Muted dummy track
    return dst.stream;
  } catch (e) {
    return null;
  }
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

// ---------- Auto-Join from URL (`?room=ABCDE`) ----------
window.addEventListener('DOMContentLoaded', () => {
  const urlParams = new URLSearchParams(window.location.search);
  const roomParam = urlParams.get('room') || urlParams.get('code');
  if (roomParam && roomParam.length === 5) {
    codeInput.value = roomParam.toUpperCase();
    joinRoomWithCode(roomParam.toUpperCase());
  }
});
