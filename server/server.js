const express   = require('express');
const http      = require('http');
const WebSocket = require('ws');
const cors      = require('cors');
const path      = require('path');
const { v4: uuidv4 } = require('uuid');

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const server = http.createServer(app);
const wss    = new WebSocket.Server({ server });

// Connected G2 plugin clients
const pluginClients = new Set();

// Responses sent back from the glasses (kept last 50)
const responses = [];
function storeResponse(text) {
  responses.unshift({ text, receivedAt: new Date().toISOString() });
  if (responses.length > 50) responses.pop();
}

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

      // Response sent back from the glasses via the menu
      if (msg.type === 'response' && typeof msg.text === 'string') {
        console.log(`Response from glasses: "${msg.text}"`);
        storeResponse(msg.text);
      }

    } catch (e) { /* ignore malformed messages */ }
  });

  ws.on('close', () => {
    if (ws.isPlugin) {
      pluginClients.delete(ws);
      console.log(`Plugin disconnected: ${id}  (remaining: ${pluginClients.size})`);
    }
  });
});

// POST /send — push a script to the glasses
app.post('/send', (req, res) => {
  const { text, secret } = req.body;

  if (process.env.SECRET && secret !== process.env.SECRET)
    return res.status(401).json({ error: 'Wrong secret' });
  if (!text || typeof text !== 'string')
    return res.status(400).json({ error: 'text field is required' });

  const payload = JSON.stringify({
    type  : 'teleprompter',
    text  : text.trim(),
    sentAt: new Date().toISOString()
  });

  let delivered = 0;
  pluginClients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) { client.send(payload); delivered++; }
  });

  console.log(`Script delivered to ${delivered} plugin(s)`);
  res.json({ ok: true, deliveredTo: delivered });
});

// GET /responses — poll for messages sent back from the glasses
app.get('/responses', (_req, res) => {
  res.json(responses);
});

// GET /status — health check
app.get('/status', (_req, res) => {
  res.json({ status: 'ok', connectedPlugins: pluginClients.size });
});

server.listen(PORT, () =>
  console.log(`G2 Teleprompter server listening on port ${PORT}`)
);
