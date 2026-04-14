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

// Last script — replayed to any plugin that connects after Send was pressed
let lastScript = null;

// Responses sent back from the glasses (kept last 50)
const responses = [];
function storeResponse(text) {
  responses.unshift({ text, receivedAt: new Date().toISOString() });
  if (responses.length > 50) responses.pop();
}

// ── Clean application logging ─────────────────────────────────────────────
function ts() {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

function appLog(id, icon, msg) {
  const short = id.slice(0, 6);
  console.log(`[${ts()}] [${short}] ${icon}  ${msg}`);
}

// ── Inactivity tracker — logs if glasses go quiet for >3 min ─────────────
const inactivityTimers = new Map();
const INACTIVITY_MS = 3 * 60 * 1000;

function resetInactivity(id) {
  if (inactivityTimers.has(id)) clearTimeout(inactivityTimers.get(id));
  const t = setTimeout(() => {
    appLog(id, '💤', 'No activity for 3 minutes — wearer may have gone quiet');
  }, INACTIVITY_MS);
  inactivityTimers.set(id, t);
}

function clearInactivity(id) {
  if (inactivityTimers.has(id)) {
    clearTimeout(inactivityTimers.get(id));
    inactivityTimers.delete(id);
  }
}

// ── WebSocket connections ─────────────────────────────────────────────────
wss.on('connection', (ws) => {
  const id = uuidv4();

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data);

      // ── Plugin registers itself ──────────────────────────────────────────
      if (msg.type === 'plugin-register') {
        ws.isPlugin = true;
        ws.clientId = id;
        pluginClients.add(ws);
        appLog(id, '🟢', `Glasses connected  (total connected: ${pluginClients.size})`);
        resetInactivity(id);
        ws.send(JSON.stringify({ type: 'registered', id }));
        // Replay last script so glasses always have something to show
        if (lastScript) {
          ws.send(lastScript);
          appLog(id, '🔄', 'Replayed last script to newly connected glasses');
        }
      }

      // ── Activity events from the glasses ─────────────────────────────────
      if (msg.type === 'activity') {
        resetInactivity(id);
        const e = msg.event;

        if (e === 'page-change') {
          appLog(id, '📄', `Page ${msg.page} of ${msg.total}`);

        } else if (e === 'script-loaded') {
          appLog(id, '📋', `Script loaded — ${msg.pages} page(s), ${msg.chars} characters`);

        } else if (e === 'menu-open') {
          appLog(id, '📂', 'Opened menu');

        } else if (e === 'menu-close') {
          appLog(id, '📁', 'Closed menu — back to script');

        } else if (e === 'silent-on') {
          appLog(id, '😶', 'Silent mode ON — display hidden');

        } else if (e === 'silent-off') {
          appLog(id, '👁 ', 'Silent mode OFF — display restored');

        } else if (e === 'app-exit') {
          appLog(id, '🚪', 'Wearer exited the app');
        }
      }

      // ── Response message sent from glasses via menu ───────────────────────
      if (msg.type === 'response' && typeof msg.text === 'string') {
        resetInactivity(id);
        appLog(id, '📨', `Message sent: "${msg.text}"`);
        storeResponse(msg.text);
      }

    } catch (e) { /* ignore malformed messages */ }
  });

  ws.on('close', () => {
    if (ws.isPlugin) {
      pluginClients.delete(ws);
      clearInactivity(id);
      appLog(id, '🔴', `Glasses disconnected  (remaining: ${pluginClients.size})`);
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

  // Cache so reconnecting glasses get the script automatically
  lastScript = payload;

  let delivered = 0;
  pluginClients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) { client.send(payload); delivered++; }
  });

  console.log(`[${ts()}] [SERVER] 📤  Script sent — ${text.trim().length} chars → ${delivered} glasses`);
  res.json({ ok: true, deliveredTo: delivered });
});

// GET /responses — poll for messages sent back from the glasses
app.get('/responses', (_req, res) => res.json(responses));

// GET /status — health check
app.get('/status', (_req, res) => {
  res.json({ status: 'ok', connectedPlugins: pluginClients.size });
});

server.listen(PORT, () =>
  console.log(`[${ts()}] [SERVER] 🚀  G2 Teleprompter listening on port ${PORT}`)
);
