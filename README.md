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

### 1. Backend (Render Free Tier)
Airwave is pre-optimized for **Render's Free Web Service**:
- **Blueprint Deployment:** Connect repo to Render and select `render.yaml` for automatic 1-click configuration.
- **Build Command:** `npm install`
- **Start Command:** `npm start` (runs `node --max-old-space-size=256 server.js` to ensure low memory footprint under Render's 512MB RAM cap).
- **Health Check Path:** `/health`

#### ⚡ Render Free Tier Optimizations Built-In:
- **Memory Guard:** Auto-sweeps stale room signaling states after 1 hour of inactivity and caps Node V8 memory to 256MB.
- **Cold Start Warmup:** Frontend auto-pings `/health` on load and displays a non-intrusive status badge while the free tier instance wakes up (~20-30s).
- **Socket.IO Heartbeats:** Configured with 45s timeouts and auto-reconnection tuned for serverless & PaaS container proxies.
- **Optional Self-Ping Keep-Alive:** Set environment variable `KEEP_ALIVE=true` or `RENDER_EXTERNAL_URL` in Render dashboard to enable automated background self-pings every 14 minutes.

### 2. Frontend (Vercel)
- Update `SIGNALING_SERVER_URL` in `public/client.js` with your deployed Render backend URL.
- Deploy the repository to **Vercel**. `vercel.json` is pre-configured to route static assets automatically.

---

## 📜 License

MIT License © 2026
