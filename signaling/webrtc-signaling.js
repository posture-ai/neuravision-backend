/**
 * WebRTC signaling over WebSocket: peer-targeted relay plus LAN POC compatibility
 * (2 peers per room, broadcast offer/answer/ICE when `target` is omitted).
 * Attach to the same HTTP server as Express so HTTP and WS share one port.
 */
const WebSocket = require('ws');
const { v4: uuidv4 } = require('uuid');

/** @type {Map<string, { peers: Map<string, import('ws')> }>} */
const sessions = new Map();

const MAX_SESSION_PEERS = 2;
const MAX_MESSAGE_BYTES = 512 * 1024;

const SIGNALING_TYPES = new Set(['offer', 'answer', 'candidate', 'ice-candidate']);

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
    if (peerId !== senderId && peer.readyState === WebSocket.OPEN) {
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

  wss.on('connection', (ws) => {
    const peerId = uuidv4();
    /** @type {{ peers: Map<string, import('ws')> } | null} */
    let currentSession = null;
    /** @type {string | null} */
    let currentSessionId = null;

    send(ws, { type: 'connected', peerId });

    ws.on('message', (raw) => {
      let data;
      try {
        const buf = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
        if (buf.length > MAX_MESSAGE_BYTES) {
          return;
        }
        data = JSON.parse(buf.toString('utf8'));
      } catch {
        return;
      }

      if (data.type === 'join') {
        const sessionId = data.sessionId || data.roomId;
        if (typeof sessionId !== 'string' || !sessionId.trim()) {
          return;
        }
        const role = typeof data.role === 'string' ? data.role : 'peer';

        if (!sessions.has(sessionId)) {
          sessions.set(sessionId, { peers: new Map() });
        }
        const session = sessions.get(sessionId);

        if (session.peers.size >= MAX_SESSION_PEERS) {
          console.warn('[webrtc-signaling] Session full:', sessionId);
          send(ws, {
            type: 'error',
            code: 'SESSION_FULL',
            message: 'LAN camera supports at most 2 peers per room'
          });
          return;
        }

        session.peers.set(peerId, ws);
        currentSession = session;
        currentSessionId = sessionId;

        console.log(`[webrtc-signaling] Peer ${peerId} joined ${sessionId} as ${role}`);

        send(ws, { type: 'joined', sessionId, peerId });
        broadcastToOthers(session, peerId, { type: 'peer-joined', peerId });
        return;
      }

      if (SIGNALING_TYPES.has(data.type)) {
        if (!currentSession) {
          return;
        }

        const target = data.target;
        if (target !== undefined && target !== null && target !== '') {
          const targetPeer = currentSession.peers.get(String(target));
          if (targetPeer && targetPeer.readyState === WebSocket.OPEN) {
            send(targetPeer, { ...data, from: peerId });
          }
          return;
        }

        if (currentSession.peers.size === MAX_SESSION_PEERS) {
          broadcastToOthers(currentSession, peerId, data);
        } else {
          console.warn(
            '[webrtc-signaling] Relay without target needs 2 peers in session; have',
            currentSession.peers.size
          );
        }
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
      console.log(`[webrtc-signaling] Peer ${peerId} disconnected`);
    });
  });

  return wss;
}

module.exports = { attachWebRtcSignaling };
