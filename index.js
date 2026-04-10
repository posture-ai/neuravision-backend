require('dotenv').config();
const http = require('http');
const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const path = require('path');
const charactersRouter = require('./routes/characters');
const { attachWebRtcSignaling } = require('./signaling/webrtc-signaling');
const { getIceServers } = require('./signaling/ice-servers');

const app = express();
const PORT = process.env.PORT || 3000;

// Support comma-separated list of allowed origins
const rawOrigins = process.env.CORS_ORIGIN || '';
const allowedOrigins = rawOrigins
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (server-to-server, curl, etc.)
      if (!origin || allowedOrigins.length === 0 || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error(`CORS: origin "${origin}" not allowed`));
      }
    },
    credentials: true
  })
);
app.use(morgan('dev'));
app.use(express.json());

// Serve static model files
app.use('/models', express.static(path.join(__dirname, 'models')));

// Health check endpoint
app.get('/health', async (_req, res) => {
  const iceServers = await getIceServers();
  const hasTurn = iceServers.some((s) => {
    const urls = Array.isArray(s.urls) ? s.urls : [s.urls];
    return urls.some((u) => u.startsWith('turn:'));
  });
  res.json({ status: 'ok', hasTurn, iceServerCount: iceServers.length, timestamp: new Date().toISOString() });
});

// API routes
app.use('/api/characters', charactersRouter);

// Error handling middleware
app.use((err, _req, res, _next) => {
  console.error('Error:', err);
  res.status(500).json({ error: 'Internal server error', message: err.message });
});

const server = http.createServer(app);
attachWebRtcSignaling(server);

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Backend server running on http://0.0.0.0:${PORT}`);
  console.log(`WebRTC signaling WebSocket on ws://0.0.0.0:${PORT}`);
  if (allowedOrigins.length > 0) {
    console.log(`CORS allowed origins: ${allowedOrigins.join(', ')}`);
  } else {
    console.log('CORS: all origins allowed (CORS_ORIGIN not set)');
  }
  // Pre-warm ICE server cache so the first session doesn't wait for KVS
  getIceServers().then((servers) => {
    const hasTurn = servers.some((s) => {
      const urls = Array.isArray(s.urls) ? s.urls : [s.urls];
      return urls.some((u) => u.startsWith('turn:'));
    });
    console.log(`[ice-servers] Pre-warmed: ${servers.length} server(s), TURN=${hasTurn}`);
  }).catch((err) => {
    console.error('[ice-servers] Pre-warm failed:', err.message);
  });
});
