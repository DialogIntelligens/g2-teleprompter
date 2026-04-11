const express  = require('express');
const http     = require('http');
const WebSocket = require('ws');
const cors     = require('cors');
const path     = require('path');
const { v4: uuidv4 } = require('uuid');

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const server = http.createServer(app);
const wss    = new WebSocket.Server({ server });

// All connected G2 plugin clients (running on the phone)
const pluginClients = new Set();

wss.on('connection', (ws) => {
  const id = uuidv4();

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data);
      if (msg.type === 'plugin-register') {
        ws.isPlugin = true;
        ws.clientId = id;
        pluginClients.add(ws);
        console.log(`Plugin connected: ${id}  (total: ${pluginClients.size})`);
        ws.send(JSON.stringify({ type: 'registered', id }));
      }
    } catch (e) { /* ignore */ }
  });

  ws.on('close', () => {
    if (ws.isPlugin) {
      pluginClients.delete(ws);
      console.log(`Plugin disconnected: ${id}  (remaining: ${pluginClients.size})`);
    }
  });
});

// POST /send  — friend calls this to push a script to the glasses
app.post('/send', (req, res) => {
  const { text, secret } = req.body;

  // Optional password protection
  if (process.env.SECRET && secret !== process.env.SECRET) {
    return res.status(401).json({ error: 'Wrong secret' });
  }
  if (!text || typeof text !== 'string') {
    return res.status(400).json({ error: 'text field is required' });
  }

  const payload = JSON.stringify({
    type   : 'teleprompter',
    text   : text.trim(),
    sentAt : new Date().toISOString()
  });

  let delivered = 0;
  pluginClients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
      delivered++;
    }
  });

  console.log(`Script delivered to ${delivered} plugin(s)`);
  res.json({ ok: true, deliveredTo: delivered });
});

// GET /status — quick health check
app.get('/status', (_req, res) => {
  res.json({ status: 'ok', connectedPlugins: pluginClients.size });
});

server.listen(PORT, () =>
  console.log(`G2 Teleprompter server listening on port ${PORT}`)
);
