// ---- keep terminal silent ----
const _noop = () => {};
console.log = _noop;
console.info = _noop;
console.warn = _noop;
console.debug = _noop;
// keep console.error mapped to dashboard instead of terminal
console.error = (e) => {
  try { require('./lib/logs').addGlobalLog({ message: `[ERR] ${e?.message || e}`, type: 'error' }); } catch (_) {}
};

const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');

const config = require('./config');
const { fmtUptime } = require('./lib/util');
const { setIO } = require('./lib/broadcast');
const { sessions, tasks } = require('./lib/store');
const { addGlobalLog } = require('./lib/logs');
const { initSocket } = require('./socket');
const { startCleanup } = require('./lib/cleanup');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' },
  pingInterval: 25_000,
  pingTimeout: 60_000,
  maxHttpBufferSize: 1e6,
});

setIO(io);
app.use(express.static(path.join(__dirname, 'public'), { maxAge: '1h' }));

function healthData() {
  const mem = process.memoryUsage();
  return {
    app: config.APP_NAME,
    version: config.APP_VERSION,
    status: 'ok',
    message: 'Madhu Mishra bot is alive ✅',
    uptimeSec: Math.floor(process.uptime()),
    uptimeHuman: fmtUptime(Date.now() - config.START_TIME),
    memoryMB: Math.round(mem.rss / 1024 / 1024),
    heapUsedMB: Math.round(mem.heapUsed / 1024 / 1024),
    totalSessions: sessions.size,
    activeSessions: [...sessions.values()].filter(s => s.status === 'connected').length,
    totalTasks: tasks.size,
    activeTasks: [...tasks.values()].filter(t => t.status === 'running').length,
    serverTime: new Date().toISOString(),
    serverEpochMs: Date.now(),
    tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
  };
}

app.get('/health', (_, res) => res.status(200).json(healthData()));
app.head('/health', (_, res) => res.status(200).end());

app.get('/api/time', (_, res) => res.json({
  epochMs: Date.now(),
  iso: new Date().toISOString(),
  tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
}));

app.get('/api/stats', (_, res) => {
  const d = healthData();
  delete d.serverTime;
  res.json(d);
});

app.get('/', (_, res) => res.status(200).send(`${config.APP_NAME} bot is running ✅`));
app.head('*', (_, res) => res.status(200).end());

initSocket(io);
startCleanup();

process.on('SIGINT', async () => {
  try { for (const s of sessions.values()) { try { s.sock?.end(undefined); } catch (_) {} } } catch (_) {}
  process.exit(0);
});
process.on('SIGTERM', () => process.emit('SIGINT'));
process.on('uncaughtException', (e) => {
  try { addGlobalLog({ message: `[FATAL] ${e.message}`, type: 'error' }); } catch (_) {}
});
process.on('unhandledRejection', (r) => {
  try { addGlobalLog({ message: `[REJECT] ${r?.message || r}`, type: 'error' }); } catch (_) {}
});

server.listen(config.PORT, () => {
  addGlobalLog({
    message: `✨ ${config.APP_NAME} server online — port ${config.PORT}`,
    type: 'success',
  });
});
