const { getGlobalLogs } = require('./lib/logs');
const {
  createSession, logoutSession, deleteSession,
  getUserSessions, serializeSession,
} = require('./lib/sessionManager');
const {
  startTask, stopTask, getTask, getUserTasks,
} = require('./lib/taskManager');

function initSocket(io) {
  io.on('connection', (socket) => {
    socket.on('register', (data) => {
      const ownerKey = String(data?.ownerKey || '').trim();
      if (ownerKey.length < 8) {
        return socket.emit('errorMsg', { message: 'Invalid owner key' });
      }
      socket.ownerKey = ownerKey;
      socket.join(`owner:${ownerKey}`);

      socket.emit('registered', { ownerKey });
      socket.emit('sessionList', getUserSessions(ownerKey));
      socket.emit('taskList', getUserTasks(ownerKey));
      socket.emit('globalLogs', getGlobalLogs(ownerKey));
    });

    const guard = (fn) => async (data) => {
      try {
        if (!socket.ownerKey) throw new Error('Not registered');
        await fn(data || {});
      } catch (e) {
        socket.emit('errorMsg', { message: e.message || String(e) });
      }
    };

    socket.on('createSession', guard(async ({ phoneNumber }) => {
      const phone = String(phoneNumber || '').replace(/[^0-9]/g, '');
      if (!phone) throw new Error('Valid phone number required');
      await createSession(socket.ownerKey, phone);
      socket.emit('sessionList', getUserSessions(socket.ownerKey));
    }));

    socket.on('logoutSession', guard(async ({ sessionId }) => {
      await logoutSession(sessionId, socket.ownerKey);
      socket.emit('sessionList', getUserSessions(socket.ownerKey));
    }));

    socket.on('deleteSession', guard(async ({ sessionId }) => {
      await deleteSession(sessionId, socket.ownerKey);
      socket.emit('sessionList', getUserSessions(socket.ownerKey));
    }));

    socket.on('getSessions', guard(async () => {
      socket.emit('sessionList', getUserSessions(socket.ownerKey));
    }));

    socket.on('createTask', guard(async (d) => {
      const { sessionId, targetJid, messages, prefix, delaySec } = d;
      await startTask(socket.ownerKey, sessionId, targetJid, messages, prefix, delaySec);
      socket.emit('taskList', getUserTasks(socket.ownerKey));
    }));

    socket.on('stopTask', guard(async ({ taskId }) => {
      stopTask(taskId, socket.ownerKey);
      socket.emit('taskList', getUserTasks(socket.ownerKey));
    }));

    socket.on('getTask', guard(async ({ taskId }) => {
      socket.emit('taskInfo', getTask(taskId, socket.ownerKey));
    }));

    socket.on('getTasks', guard(async () => {
      socket.emit('taskList', getUserTasks(socket.ownerKey));
    }));

    socket.on('getGlobalLogs', guard(async () => {
      socket.emit('globalLogs', getGlobalLogs(socket.ownerKey));
    }));

    // ✅ Session-specific group fetch
    socket.on('getGroups', guard(async ({ sessionId }) => {
      const { sessions } = require('./lib/store');
      const session = sessions.get(sessionId);
      if (!session || session.ownerKey !== socket.ownerKey) {
        throw new Error('Session not found');
      }
      if (!session.sock) throw new Error('Session not connected');
      if (session.status !== 'connected') throw new Error('Session not connected yet');

      const groups = await session.sock.groupFetchAllParticipating();
      const list = Object.values(groups)
        .map(g => ({ id: g.id, subject: g.subject }))
        .sort((a, b) => a.subject.localeCompare(b.subject));

      socket.emit('groupList', { sessionId, groups: list });
    }));
  });
}

module.exports = { initSocket };
