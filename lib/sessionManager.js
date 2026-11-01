const fs = require('fs');
const path = require('path');
const pino = require('pino');
const {
  default: makeWASocket,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  delay,
  DisconnectReason,
} = require('@whiskeysockets/baileys');

const {
  SESSION_ROOT, MAX_SESSIONS_PER_USER, MAX_TOTAL_SESSIONS, DEFAULT_DELAY_SEC,
} = require('../config');
const { sessions, tasks, genSessionId } = require('./store');
const { addGlobalLog } = require('./logs');
const { toOwner } = require('./broadcast');
const { safeId } = require('./util');

function sessionDir(sessionId) {
  return path.join(SESSION_ROOT, safeId(sessionId));
}

function serializeSession(s) {
  return {
    id: s.id,
    phoneNumber: s.phoneNumber,
    status: s.status,
    createdAt: s.createdAt,
    lastActiveAt: s.lastActiveAt,
    pairingCode: s.pairingCode,
  };
}

async function createSession(ownerKey, phoneNumber) {
  const mine = [...sessions.values()].filter(s => s.ownerKey === ownerKey);
  if (mine.length >= MAX_SESSIONS_PER_USER) {
    throw new Error(`Max ${MAX_SESSIONS_PER_USER} sessions per user allowed`);
  }
  if (sessions.size >= MAX_TOTAL_SESSIONS) {
    throw new Error('Server session limit reached. Try later.');
  }

  const sessionId = genSessionId();
  const dir = sessionDir(sessionId);
  fs.mkdirSync(dir, { recursive: true });

  const session = {
    id: sessionId,
    ownerKey,
    phoneNumber,
    sock: null,
    status: 'starting',
    createdAt: Date.now(),
    lastActiveAt: Date.now(),
    pairingCode: null,
    targetDir: dir,
    _pairingRequested: false,
    _retry: true,
  };
  sessions.set(sessionId, session);

  await startSession(session);
  return serializeSession(session);
}

async function startSession(session) {
  const { state, saveCreds } = await useMultiFileAuthState(session.targetDir);
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    logger: pino({ level: 'silent' }),
    printQRInTerminal: false,
    auth: state,
    browser: ['Ubuntu', 'Chrome', '20.0.0'],
    syncFullHistory: false,
    markOnlineOnConnect: false,
    generateHighQualityLinkPreview: false,
    defaultQueryTimeoutMs: 60_000,
    keepAliveIntervalMs: 30_000,
  });

  session.sock = sock;
  session._pairingRequested = false;

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async (u) => {
    const { connection, lastDisconnect } = u;
    if (!sessions.has(session.id)) {
      try { sock.end(undefined); } catch (_) {}
      return;
    }

    if (connection === 'connecting'
        && !sock.authState.creds.registered
        && !session._pairingRequested) {
      session._pairingRequested = true;
      await delay(3500); // keep time-sync safe
      try {
        let code = await sock.requestPairingCode(session.phoneNumber);
        code = code?.match(/.{1,4}/g)?.join('-') || code;
        session.pairingCode = code;
        session.status = 'awaiting_pair';
        addGlobalLog({
          ownerKey: session.ownerKey,
          message: `[PAIR] Session ${session.id} code: ${code}`,
          type: 'success',
        });
        toOwner(session.ownerKey, 'pairingCode', { sessionId: session.id, code });
        toOwner(session.ownerKey, 'sessionUpdate', serializeSession(session));
      } catch (e) {
        session.status = 'failed';
        addGlobalLog({
          ownerKey: session.ownerKey,
          message: `[PAIR FAIL] ${e.message || e}`,
          type: 'error',
        });
        toOwner(session.ownerKey, 'sessionUpdate', serializeSession(session));
      }
    }

    if (connection === 'open') {
      session.status = 'connected';
      session.lastActiveAt = Date.now();
      session.pairingCode = null;
      addGlobalLog({
        ownerKey: session.ownerKey,
        message: `[CONNECT] Session ${session.id} (${session.phoneNumber}) online ✅`,
        type: 'success',
      });
      toOwner(session.ownerKey, 'sessionUpdate', serializeSession(session));
    }

    if (connection === 'close') {
      const code = lastDisconnect?.error?.output?.statusCode;
      const loggedOut = code === DisconnectReason.loggedOut || code === 401;

      if (loggedOut) {
        session.status = 'logged_out';
        session.sock = null;
        // stop tasks bound to this session
        for (const t of tasks.values()) {
          if (t.sessionId === session.id) {
            t.loopRunning = false;
            t.stoppedAt = Date.now();
          }
        }
        addGlobalLog({
          ownerKey: session.ownerKey,
          message: `[LOGOUT] Session ${session.id} expired / logged out`,
          type: 'error',
        });
        toOwner(session.ownerKey, 'sessionUpdate', serializeSession(session));
      } else if (session._retry && sessions.has(session.id)) {
        session.status = 'reconnecting';
        session.sock = null;
        toOwner(session.ownerKey, 'sessionUpdate', serializeSession(session));
        await delay(3000);
        if (!sessions.has(session.id)) return;
        try {
          await startSession(session);
        } catch (e) {
          session.status = 'failed';
          toOwner(session.ownerKey, 'sessionUpdate', serializeSession(session));
        }
      }
    }
  });
}

async function logoutSession(sessionId, ownerKey) {
  const s = sessions.get(sessionId);
  if (!s || s.ownerKey !== ownerKey) throw new Error('Session not found');
  s._retry = false;
  try { if (s.sock) await s.sock.logout(); } catch (_) {}
  s.status = 'logged_out';
  s.lastActiveAt = Date.now();
  for (const t of tasks.values()) {
    if (t.sessionId === sessionId) { t.loopRunning = false; t.stoppedAt = Date.now(); }
  }
  return serializeSession(s);
}

async function deleteSession(sessionId, ownerKey) {
  const s = sessions.get(sessionId);
  if (!s || s.ownerKey !== ownerKey) throw new Error('Session not found');
  s._retry = false;
  try { if (s.sock) s.sock.end(undefined); } catch (_) {}
  for (const t of tasks.values()) {
    if (t.sessionId === sessionId) { t.loopRunning = false; t.stoppedAt = Date.now(); }
  }
  sessions.delete(sessionId);
  try { fs.rmSync(s.targetDir, { recursive: true, force: true }); } catch (_) {}
  addGlobalLog({
    ownerKey,
    message: `[DELETE] Session ${sessionId} deleted`,
    type: 'warn',
  });
}

function getUserSessions(ownerKey) {
  return [...sessions.values()]
    .filter(s => s.ownerKey === ownerKey)
    .map(serializeSession);
}

function cleanupSessions(maxAgeMs) {
  const now = Date.now();
  for (const [id, s] of [...sessions]) {
    if ((s.status === 'logged_out' || s.status === 'failed')
        && (now - s.lastActiveAt) > maxAgeMs) {
      deleteSession(id, s.ownerKey).catch(() => {});
    }
  }
}

module.exports = {
  createSession, logoutSession, deleteSession,
  getUserSessions, serializeSession, cleanupSessions,
  DEFAULT_DELAY_SEC,
};
