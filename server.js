const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const crypto = require('crypto');

const app = express();
app.disable('x-powered-by');

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  },
  pingInterval: 20000,
  pingTimeout: 25000,
  transports: ['websocket', 'polling']
});

// Serve static frontend assets
app.use(express.static(path.join(__dirname, 'public')));

// roomCode -> { host: socketId|null, guest: socketId|null, createdAt: timestamp, lastActive: timestamp }
const rooms = {};
const MAX_ROOMS = 500;
const ROOM_TTL_MS = 60 * 60 * 1000; // 1 hour TTL for stale rooms

// Health check endpoint for Render monitoring, warmups, and keep-alive pings
app.get('/health', (_req, res) => {
  res.status(200).json({
    status: 'ok',
    uptime: Math.floor(process.uptime()),
    activeRooms: Object.keys(rooms).length,
    timestamp: new Date().toISOString()
  });
});

// Periodic Garbage Collection sweep for stale/inactive rooms (runs every 10 minutes)
setInterval(() => {
  const now = Date.now();
  for (const [code, room] of Object.entries(rooms)) {
    if (now - room.lastActive > ROOM_TTL_MS) {
      delete rooms[code];
    }
  }
}, 10 * 60 * 1000);

function generateRoomCode() {
  // 5 char, easy to read/type: no 0/O/1/I confusion
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code;
  let attempts = 0;
  do {
    code = Array.from({ length: 5 }, () => chars[crypto.randomInt(chars.length)]).join('');
    attempts++;
  } while (rooms[code] && attempts < 100);
  return code;
}

io.on('connection', (socket) => {
  socket.data.roomCode = null;
  socket.data.role = null;

  socket.on('create-room', (_data, callback) => {
    if (Object.keys(rooms).length >= MAX_ROOMS) {
      callback({ ok: false, error: 'Server is at maximum capacity. Please try again shortly.' });
      return;
    }
    const code = generateRoomCode();
    const now = Date.now();
    rooms[code] = { host: socket.id, guest: null, createdAt: now, lastActive: now };
    socket.join(code);
    socket.data.roomCode = code;
    socket.data.role = 'host';
    callback({ ok: true, roomCode: code });
  });

  socket.on('join-room', (data, callback) => {
    const code = (data && data.roomCode || '').toUpperCase().trim();
    const room = rooms[code];
    if (!room) {
      callback({ ok: false, error: 'Room not found. Check the code and try again.' });
      return;
    }
    if (room.guest) {
      callback({ ok: false, error: 'This room already has two people in it.' });
      return;
    }
    room.guest = socket.id;
    room.lastActive = Date.now();
    socket.join(code);
    socket.data.roomCode = code;
    socket.data.role = 'guest';
    callback({ ok: true, roomCode: code });
    // tell the host someone joined so it can start the WebRTC offer
    io.to(room.host).emit('peer-joined');

    // Flush any signals buffered before guest joined
    if (room.pendingSignals && room.pendingSignals.length > 0) {
      room.pendingSignals.forEach(item => {
        if (item.targetRole === 'guest') {
          io.to(room.guest).emit('signal', item.signal);
        }
      });
      room.pendingSignals = room.pendingSignals.filter(item => item.targetRole !== 'guest');
    }
  });

  // Relay reactions (emojis) to the other peer in the room
  socket.on('reaction', (data) => {
    const code = socket.data.roomCode;
    const room = rooms[code];
    if (!room) return;
    room.lastActive = Date.now();
    const targetId = socket.data.role === 'host' ? room.guest : room.host;
    if (targetId) {
      io.to(targetId).emit('reaction', data);
    }
  });

  // Relay WebRTC signaling data (SDP offers/answers, ICE candidates) to the other peer in the room
  socket.on('signal', (data) => {
    const code = socket.data.roomCode;
    const room = rooms[code];
    if (!room) return;
    room.lastActive = Date.now();
    const targetRole = socket.data.role === 'host' ? 'guest' : 'host';
    const targetId = socket.data.role === 'host' ? room.guest : room.host;
    if (targetId) {
      io.to(targetId).emit('signal', data.signal);
    } else {
      // Buffer signaling message (SDP or ICE candidate) until target peer joins room
      room.pendingSignals = room.pendingSignals || [];
      room.pendingSignals.push({ targetRole, signal: data.signal });
    }
  });

  socket.on('disconnect', () => {
    const code = socket.data.roomCode;
    const room = rooms[code];
    if (!room) return;
    const otherId = socket.data.role === 'host' ? room.guest : room.host;
    if (otherId) {
      io.to(otherId).emit('peer-left');
    }
    delete rooms[code];
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Audio sync server running on http://0.0.0.0:${PORT}`);

  // Optional background keep-alive self-ping for Render free tier
  const keepAliveUrl = process.env.RENDER_EXTERNAL_URL || (process.env.KEEP_ALIVE === 'true' ? `http://localhost:${PORT}` : null);
  if (keepAliveUrl) {
    const httpModule = keepAliveUrl.startsWith('https') ? require('https') : require('http');
    console.log(`Keep-alive self-ping activated for: ${keepAliveUrl}/health`);
    setInterval(() => {
      httpModule.get(`${keepAliveUrl}/health`, (res) => {
        res.on('data', () => {});
      }).on('error', (err) => {
        console.warn(`Keep-alive ping error: ${err.message}`);
      });
    }, 14 * 60 * 1000); // Ping every 14 minutes to prevent 15-minute Render sleep
  }
});

