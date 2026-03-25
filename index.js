require('dotenv').config();
const http = require('http');
const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const path = require('path');
const charactersRouter = require('./routes/characters');
const { attachWebRtcSignaling } = require('./signaling/webrtc-signaling');

const app = express();
const PORT = process.env.PORT || 3000;
const CORS_ORIGIN = process.env.CORS_ORIGIN || 'http://localhost:5173';

// Middleware
app.use(cors({
  origin: CORS_ORIGIN,
  credentials: true
}));
app.use(morgan('dev'));
app.use(express.json());

// Serve static model files
app.use('/models', express.static(path.join(__dirname, 'models')));

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// API routes
app.use('/api/characters', charactersRouter);

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(500).json({ error: 'Internal server error', message: err.message });
});

const server = http.createServer(app);
attachWebRtcSignaling(server);

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Backend server running on http://0.0.0.0:${PORT}`);
  console.log(`WebRTC signaling WebSocket on ws://0.0.0.0:${PORT} (same port as HTTP)`);
  console.log(`CORS enabled for origin: ${CORS_ORIGIN}`);
  console.log(`Serving models from: ${path.join(__dirname, 'models')}`);
});
