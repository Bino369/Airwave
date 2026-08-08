# ))) Airwave

> Play something on your machine. It plays on theirs. Same moment, no upload, no file.

Airwave is a real-time, browser-to-browser audio sharing application. Built with **WebRTC** and **PeerJS Cloud Signaling**, it lets a host broadcast system audio or a specific browser tab directly to a listener in real-time with ultra-low latency.

---

## ⚡ Features

- **100% Serverless & Free:** Hosted entirely on **Vercel** as a static WebRTC application with **zero backend server**, **0-second cold starts**, and **zero maintenance**.
- **Multi-Network NAT Traversal:** Integrated with multi-region STUN and **Metered OpenRelay TURN servers** to ensure reliable connectivity across 4G/5G, hotspots, and firewalls.
- **Easy Room Sharing:** Generate & join rooms using simple 5-character codes or QR links.
- **Tab & System Audio Capture:** Capture tab audio or whole-system sound with a single click.
- **DJ Mic Overlay:** Blend your microphone live over system audio with a dedicated volume slider.
- **Ambient Equalizer:** Modern dark UI with live frequency animation.

---

## 🛠️ Tech Stack

- **Frontend:** HTML5, Modern CSS, WebRTC (`RTCPeerConnection`, `getDisplayMedia`), Vanilla JavaScript
- **Signaling:** PeerJS Cloud Signaling (Serverless WebRTC Cloud)
- **Deployment:** 100% Vercel Static Hosting

---

## ☁️ Deployment (100% Vercel)

Deploying Airwave is 100% automated with zero server configuration required:

1. Import this repository into **[Vercel](https://vercel.com)**.
2. Click **Deploy**.
3. That's it! Your real-time audio sharing app is live with 0-second cold starts.

---

## 📜 License

MIT License © 2026
