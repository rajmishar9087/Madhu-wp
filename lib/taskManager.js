const { delay } = require('@whiskeysockets/baileys');
const {
  MAX_TASKS_PER_USER, MAX_TOTAL_TASKS, TASK_RETENTION_MS,
} = require('../config');
const { tasks, sessions, genTaskId } = require('./store');
const { addGlobalLog, addTaskLog } = require('./logs');
const { toOwner } = require('./broadcast');

function serializeTask(t) {
  return {
    id: t.id,
    sessionId: t.sessionId,
    targetJid: t.targetJid,
    status: t.status,
    startTime: t.startTime,
    endTime: t.endTime,
    stoppedAt: t.stoppedAt,
    sentCount: t.sentCount,
    roundCount: t.roundCount,
    totalMessages: t.messages.length,
    currentIndex: t.currentIndex,
    prefix: t.prefix,
    delayMs: t.delayMs,
  };
}

async function startTask(ownerKey, sessionId, targetJid, messages, prefix, delaySec) {
  const mine = [...tasks.values()].filter(t => t.ownerKey === ownerKey && t.status === 'running');
  if (mine.length >= MAX_TASKS_PER_USER) {
    throw new Error(`Max ${MAX_TASKS_PER_USER} running tasks per user`);
  }
  if (tasks.size >= MAX_TOTAL_TASKS) {
    throw new Error('Server task limit reached. Try later.');
  }
  const session = sessions.get(sessionId);
  if (!session || session.ownerKey !== ownerKey) throw new Error('Session not found');
  if (!session.sock) throw new Error('Session not connected. Connect first.');

  const cleanMessages = (messages || [])
    .map(m => String(m || '').trim())
    .filter(Boolean);
  if (!cleanMessages.length) throw new Error('Messages list is empty');

  // ✅ FIX: JID Normalization (Phone number to JID)
  let finalJid = String(targetJid).trim();
  if (/^[0-9]+$/.test(finalJid)) {
    finalJid = `${finalJid}@s.whatsapp.net`;
  }

  const taskId = genTaskId();
  const task = {
    id: taskId,
    ownerKey,
    sessionId,
    targetJid: finalJid, // Ab normalized JID save hoga
    messages: cleanMessages,
    prefix: String(prefix || '').trim(),
    delayMs: Math.max(2, parseInt(delaySec, 10) || 5) * 1000,
    status: 'starting',
    startTime: Date.now(),
    endTime: null,
    stoppedAt: null,
    sentCount: 0,
    roundCount: 1,
    currentIndex: 0,
    loopRunning: true,
    logs: [],
  };
  tasks.set(taskId, task);

  addGlobalLog({
    ownerKey,
    message: `[TASK] ${taskId} created → ${task.targetJid}`,
    type: 'success',
  });
  toOwner(ownerKey, 'taskUpdate', serializeTask(task));

  runTaskLoop(task);
  return serializeTask(task);
}

async function runTaskLoop(task) {
  task.status = 'running';
  toOwner(task.ownerKey, 'taskUpdate', serializeTask(task));

  while (task.loopRunning) {
    const session = sessions.get(task.sessionId);
    if (!session || !session.sock) {
      addTaskLog(task, 'Session disconnected. Pausing.', 'warn');
      break;
    }
    for (let i = 0; i < task.messages.length; i++) {
      if (!task.loopRunning) break;
      task.currentIndex = i + 1;

      const liveSess = sessions.get(task.sessionId);
      if (!liveSess || !liveSess.sock) {
        addTaskLog(task, 'Session lost. Stopping.', 'error');
        task.loopRunning = false;
        break;
      }

      task.sentCount++;
      const fullMessage = [task.prefix, task.messages[i]]
        .filter(Boolean)
        .join(' ')
        .trim();

      try {
        // Message bhejte waqt ab koi error nahi aayega kyunki JID fix ho chuka hai
        await liveSess.sock.sendMessage(task.targetJid, { text: fullMessage });
        addTaskLog(
          task,
          `[SENT] #${task.sentCount} R${task.roundCount} [${i + 1}/${task.messages.length}]: ${fullMessage.slice(0, 80)}`,
          'success'
        );
      } catch (e) {
        addTaskLog(task, `[FAIL] #${task.sentCount}: ${e.message || e}`, 'error');
      }

      if (task.sentCount % 5 === 0) {
        toOwner(task.ownerKey, 'taskUpdate', serializeTask(task));
      }
      await delay(task.delayMs);
    }
    if (!task.loopRunning) break;
    task.roundCount++;
    addTaskLog(task, `Round ${task.roundCount} start`, 'info');
  }

  task.status = 'stopped';
  task.endTime = Date.now();
  task.stoppedAt = task.stoppedAt || Date.now();
  toOwner(task.ownerKey, 'taskUpdate', serializeTask(task));
  addTaskLog(task, `Task stopped. Total sent: ${task.sentCount}`, 'warn');
}

function stopTask(taskId, ownerKey) {
  const t = tasks.get(taskId);
  if (!t || t.ownerKey !== ownerKey) throw new Error('Task not found');
  t.loopRunning = false;
  t.stoppedAt = Date.now();
  addTaskLog(t, 'Stop requested by user.', 'warn');
  toOwner(ownerKey, 'taskUpdate', serializeTask(t));
  return serializeTask(t);
}

function getTask(taskId, ownerKey) {
  const t = tasks.get(taskId);
  if (!t || t.ownerKey !== ownerKey) throw new Error('Task not found');
  return { ...serializeTask(t), logs: t.logs };
}

function getUserTasks(ownerKey) {
  return [...tasks.values()]
    .filter(t => t.ownerKey === ownerKey)
    .map(serializeTask);
}

function cleanupTasks() {
  const now = Date.now();
  const affected = new Set();
  for (const [id, t] of [...tasks]) {
    if (t.status === 'stopped'
        && t.stoppedAt
        && (now - t.stoppedAt) > TASK_RETENTION_MS) {
      tasks.delete(id);
      affected.add(t.ownerKey);
    }
  }
  for (const ownerKey of affected) {
    toOwner(ownerKey, 'taskList', getUserTasks(ownerKey));
  }
  if (affected.size) {
    addGlobalLog({ message: `[CLEANUP] purged old stopped tasks`, type: 'info' });
  }
}

module.exports = {
  startTask, stopTask, getTask, getUserTasks,
  serializeTask, cleanupTasks,
};
