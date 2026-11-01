const {
  LOG_RETENTION_MS, MAX_TASK_LOGS, MAX_GLOBAL_LOGS,
} = require('../config');
const { toOwner, toAll } = require('./broadcast');

const globalLogs = [];

function cleanupGlobal() {
  const cutoff = Date.now() - LOG_RETENTION_MS;
  while (globalLogs.length && globalLogs[0].ts < cutoff) globalLogs.shift();
  while (globalLogs.length > MAX_GLOBAL_LOGS) globalLogs.shift();
}

function addGlobalLog(entry) {
  const e = { ...entry, ts: entry.ts || Date.now() };
  globalLogs.push(e);
  if (e.ownerKey) toOwner(e.ownerKey, 'log', e);
  else toAll('log', e);
  cleanupGlobal();
}

function getGlobalLogs(ownerKey) {
  cleanupGlobal();
  return globalLogs.filter(l => !l.ownerKey || l.ownerKey === ownerKey);
}

function addTaskLog(task, msg, type = 'info') {
  const entry = { message: msg, type, ts: Date.now() };
  task.logs.push(entry);
  if (task.logs.length > MAX_TASK_LOGS) task.logs.shift();
  toOwner(task.ownerKey, 'taskLog', {
    taskId: task.id,
    ownerKey: task.ownerKey,
    ...entry,
  });
}

module.exports = { addGlobalLog, getGlobalLogs, addTaskLog, cleanupGlobal };
