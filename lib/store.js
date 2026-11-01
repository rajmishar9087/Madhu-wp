const crypto = require('crypto');

const sessions = new Map(); // sessionId -> Session
const tasks = new Map();    // taskId    -> Task

function genSessionId() {
  return `SESS-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
}
function genTaskId() {
  return `TASK-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
}

module.exports = { sessions, tasks, genSessionId, genTaskId };
