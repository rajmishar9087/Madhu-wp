const { CLEANUP_INTERVAL_MS, TASK_RETENTION_MS, SESSION_RETENTION_MS } = require('../config');
const { cleanupTasks } = require('./taskManager');
const { cleanupSessions } = require('./sessionManager');
const { cleanupGlobal } = require('./logs');

function startCleanup() {
  setInterval(() => {
    try { cleanupTasks(); } catch (_) {}
    try { cleanupSessions(SESSION_RETENTION_MS); } catch (_) {}
    try { cleanupGlobal(); } catch (_) {}
  }, CLEANUP_INTERVAL_MS).unref?.();
}

module.exports = { startCleanup };
