# Neurabody TV Backend

Express backend server for the Samsung TV App that serves 3D character models and animations.

## Setup

1. Install dependencies:
```bash
npm install
```

2. Configure environment (optional):
Edit `.env` file to change settings:
```
PORT=3000
NODE_ENV=development
CORS_ORIGIN=http://localhost:5173
```

## Running the Server

### Development mode (with auto-reload):
```bash
npm run dev
```

### Production mode:
```bash
npm start
```

The server will start on `http://localhost:3000` (or the port specified in `.env`).

## WebRTC signaling (LAN camera)

The same process exposes a **WebSocket** server on **the same port** as HTTP (Upgrade). Use:

`ws://<host>:<PORT>`

Example with `PORT=3001` in `.env`: `ws://192.168.1.10:3001`

**Samsung `tvapp` LAN camera mode:** set `VITE_LAN_SIGNALING_WS` to that URL (phone and TV must reach this host). The phone page is a static HTML file in **[`pose-webview2/index.html`](../pose-webview2/index.html)** — host it separately; set **`VITE_LAN_PHONE_PAGE_BASE`** to that HTTP origin (see [`tvapp/README.md`](../tvapp/README.md)).

The relay supports:

- **LAN POC (2 peers per room):** `{ type: 'join', roomId }` (or `sessionId`), then `offer` / `answer` / `ice-candidate` **without** `target` — messages are forwarded to the other peer.
- **Peer-targeted mode:** `join` with `sessionId` and optional `role`; signaling messages with `target` are delivered to that peer; server adds `from` on forwarded messages.

Max **2 peers** per room for the broadcast relay path.

## API Endpoints

### Health Check
- **GET** `/health`
- Returns server status

### Get Characters List
- **GET** `/api/characters`
- Returns list of available characters with their animations

Response format:
```json
{
  "characters": [
    {
      "id": "ch03",
      "name": "Character 03",
      "modelUrl": "/models/ch03/Ch03_nonPBR.fbx",
      "thumbnail": "/models/ch03/thumbnail.jpg",
      "animations": [
        {"name": "idle", "url": "/models/ch03/idle.fbx"},
        {"name": "walking", "url": "/models/ch03/walking.fbx"}
      ]
    }
  ]
}
```

### Static Files
- **GET** `/models/:character/:file`
- Serves 3D model and animation files
- Example: `http://localhost:3000/models/ch03/Ch03_nonPBR.fbx`

## Directory Structure

```
backend/
├── index.js              # Express + HTTP server; WebRTC signaling attached
├── signaling/
│   └── webrtc-signaling.js
├── routes/
│   └── characters.js     # Character API routes
├── models/               # 3D character models and animations
│   ├── ch03/
│   ├── ch19/
│   └── ch24/
├── .env                  # Environment configuration
└── package.json
```

## Models Directory

Place your character models in the `models/` directory:
- Each character should have its own folder (e.g., `ch03`, `ch19`)
- Each folder should contain:
  - One base model file (e.g., `Ch03_nonPBR.fbx`)
  - Animation FBX files (e.g., `idle.fbx`, `walking.fbx`, etc.)

## CORS Configuration

The server allows requests from the frontend origin specified in `CORS_ORIGIN` environment variable. Update this value if your frontend runs on a different port or domain.

## Troubleshooting

### Port Already in Use
If port 3000 is already in use, change the `PORT` in `.env` file and update the frontend API configuration accordingly.

### CORS Errors
Make sure the `CORS_ORIGIN` in `.env` matches your frontend URL exactly (including protocol and port).

### Models Not Loading
- Verify model files are in the correct `models/` subdirectories
- Check file permissions
- Check browser console and server logs for errors
