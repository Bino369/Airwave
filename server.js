const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

app.use(express.static(path.join(__dirname, 'public')));

// roomCode -> { host: socketId|null, guest: socketId|null }
const rooms = {};

function generateRoomCode() {
  // 5 char, easy to read/type: no 0/O/1/I confusion
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code;
  do {
    code = Array.from({ length: 5 }, () => chars[crypto.randomInt(chars.length)]).join('');
  } while (rooms[code]);
  return code;
}

io.on('connection', (socket) => {
  socket.data.roomCode = null;
  socket.data.role = null;

  socket.on('create-room', (_data, callback) => {
    const code = generateRoomCode();
    rooms[code] = { host: socket.id, guest: null };
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
    socket.join(code);
    socket.data.roomCode = code;
    socket.data.role = 'guest';
    callback({ ok: true, roomCode: code });
    // tell the host someone joined so it can start the WebRTC offer
    io.to(room.host).emit('peer-joined');
  });

  // Relay WebRTC signaling data (SDP offers/answers, ICE candidates) to the other peer in the room
  socket.on('signal', (data) => {
    const code = socket.data.roomCode;
    const room = rooms[code];
    if (!room) return;
    const targetId = socket.data.role === 'host' ? room.guest : room.host;
    if (targetId) {
      io.to(targetId).emit('signal', data.signal);
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
server.listen(PORT, () => {
  console.log(`Audio sync server running on http://localhost:${PORT}`);
});
