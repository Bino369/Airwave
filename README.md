# ))) Airwave

> Play something on your machine. It plays on theirs. Same moment, no upload, no file.

Airwave is a real-time, browser-to-browser audio sharing application. Built with **WebRTC** and **Socket.IO**, it lets a host broadcast system audio or a specific browser tab directly to a listener in real-time with ultra-low latency.

---

## ⚡ Features

- **P2P Direct Audio:** High-quality WebRTC audio streaming directly between peers.
- **Easy Room Sharing:** Generate & join rooms using simple 5-character codes.
- **Tab & System Audio Capture:** Capture tab audio or whole-system sound with a single click.
- **Ambient Equalizer:** Modern dark UI with live frequency animation.
- **Vercel & Render Ready:** Easily hosted with frontend on Vercel and signaling backend on Render/Railway.

---

## 🛠️ Tech Stack

- **Frontend:** HTML5, Modern CSS, WebRTC (`RTCPeerConnection`, `getDisplayMedia`), Vanilla JavaScript
- **Backend:** Node.js, Express, Socket.IO (for signaling)
- **Deployment:** Vercel (Static Frontend) + Render / Railway (Signaling Backend)

---

## 🚀 Quick Start (Local Development)

1. **Clone the repository:**
   ```bash
   git clone https://github.com/Bino369/Airwave.git
   cd audio-sync-app
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Start the server:**
   ```bash
   npm start
   ```

4. **Open in browser:**
   Navigate to `http://localhost:3000` on two browser tabs or devices.

---

## ☁️ Deployment

### 1. Backend (Render / Railway / Fly.io)
Deploy `server.js` as a Node service:
- **Build Command:** `npm install`
- **Start Command:** `node server.js`

### 2. Frontend (Vercel)
- Update `SIGNALING_SERVER_URL` in `public/client.js` with your deployed backend URL.
- Deploy the repository to **Vercel**. `vercel.json` is pre-configured to route static assets automatically.

---

## 📜 License

MIT License © 2026
# Airwave
# Airwave
