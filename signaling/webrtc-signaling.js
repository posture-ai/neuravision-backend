/**
 * WebRTC signaling over WebSocket.
 * Room-based relay: up to 2 peers per room.
 * Broadcasts offer / answer / ICE candidates between peers.
 * Attaches to the same HTTP server as Express (shared port).
 */
const WebSocket = require('ws');
const { v4: uuidv4 } = require('uuid');
const { getIceServers } = require('./ice-servers');

/** @type {Map<string, { peers: Map<string, import('ws')> }>} */
const sessions = new Map();

const MAX_SESSION_PEERS = 2;
const MAX_MESSAGE_BYTES = 512 * 1024; // 512 KB
const HEARTBEAT_INTERVAL_MS = 30_000; // 30 seconds

const RELAY_TYPES = new Set(['offer', 'answer', 'candidate', 'ice-candidate']);

/**
 * @param {import('ws')} ws
 * @param {object} data
 */
function send(ws, data) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

/**
 * @param {{ peers: Map<string, import('ws')> }} session
 * @param {string} senderId
 * @param {object} message
 */
function broadcastToOthers(session, senderId, message) {
  for (const [peerId, peer] of session.peers) {
    if (peerId !== senderId) {
      send(peer, message);
    }
  }
}

/**
 * @param {import('http').Server} httpServer
 */
function attachWebRtcSignaling(httpServer) {
  const wss = new WebSocket.Server({
    server: httpServer,
    clientTracking: true,
    maxPayload: MAX_MESSAGE_BYTES
  });

  // Heartbeat: terminate dead connections every 30s
  const heartbeatTimer = setInterval(() => {
    wss.clients.forEach((ws) => {
      if (ws.isAlive === false) {
        ws.terminate();
        return;
      }
      ws.isAlive = false;
      ws.ping();
    });
  }, HEARTBEAT_INTERVAL_MS);

  wss.on('close', () => {
    clearInterval(heartbeatTimer);
  });

  wss.on('connection', (ws) => {
    const peerId = uuidv4();
    ws.isAlive = true;
    ws.on('pong', () => {
      ws.isAlive = true;
    });

    /** @type {{ peers: Map<string, import('ws')> } | null} */
    let currentSession = null;
    /** @type {string | null} */
    let currentSessionId = null;

    send(ws, { type: 'connected', peerId });

    ws.on('message', (raw) => {
      let data;
      try {
        const buf = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
        if (buf.length > MAX_MESSAGE_BYTES) return;
        data = JSON.parse(buf.toString('utf8'));
      } catch {
        return;
      }

      if (data.type === 'join') {
        const sessionId = data.sessionId || data.roomId;
        if (typeof sessionId !== 'string' || !sessionId.trim()) return;

        if (!sessions.has(sessionId)) {
          sessions.set(sessionId, { peers: new Map() });
        }
        const session = sessions.get(sessionId);

        if (session.peers.size >= MAX_SESSION_PEERS) {
          send(ws, {
            type: 'error',
            code: 'SESSION_FULL',
            message: 'Room supports at most 2 peers'
          });
          return;
        }

        session.peers.set(peerId, ws);
        currentSession = session;
        currentSessionId = sessionId;

        console.log(`[signaling] ${peerId} joined room "${sessionId}" (${session.peers.size}/2)`);

        send(ws, { type: 'joined', sessionId, peerId });
        getIceServers().then((iceServers) => send(ws, { type: 'ice-config', iceServers }));
        broadcastToOthers(session, peerId, { type: 'peer-joined', peerId });
        return;
      }

      if (RELAY_TYPES.has(data.type)) {
        if (!currentSession) return;

        const target = data.target;
        if (target != null && target !== '') {
          const targetWs = currentSession.peers.get(String(target));
          if (targetWs) send(targetWs, { ...data, from: peerId });
          return;
        }

        // Broadcast to the other peer (2-peer room)
        if (currentSession.peers.size === MAX_SESSION_PEERS) {
          broadcastToOthers(currentSession, peerId, data);
        }
        return;
      }
    });

    ws.on('close', () => {
      if (currentSession && currentSessionId) {
        currentSession.peers.delete(peerId);
        broadcastToOthers(currentSession, peerId, { type: 'peer-left', peerId });
        if (currentSession.peers.size === 0) {
          sessions.delete(currentSessionId);
        }
      }
      console.log(`[signaling] ${peerId} disconnected`);
    });

    ws.on('error', (err) => {
      console.error(`[signaling] ${peerId} error:`, err.message);
    });
  });

  return wss;
}

module.exports = { attachWebRtcSignaling };
