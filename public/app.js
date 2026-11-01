(() => {
  // -------- owner key --------
  const OWNER_KEY_STORE = 'mm_owner_key_v2';
  let ownerKey = localStorage.getItem(OWNER_KEY_STORE);
  if (!ownerKey) {
    ownerKey = 'MM-' + crypto.randomUUID();
    localStorage.setItem(OWNER_KEY_STORE, ownerKey);
  }
  document.getElementById('ownerKey').textContent = ownerKey;

  const socket = io({ reconnection: true, reconnectionDelay: 1000, reconnectionAttempts: Infinity });

  // -------- toasts --------
  function toast(msg, kind = '') {
    const el = document.createElement('div');
    el.className = `toast ${kind}`;
    el.textContent = msg;
    document.getElementById('toasts').appendChild(el);
    setTimeout(() => el.remove(), 3500);
  }

  // -------- server time sync --------
  let serverOffset = 0;
  async function syncTime() {
    try {
      const t0 = Date.now();
      const r = await fetch('/api/time').then(r => r.json());
      const t1 = Date.now();
      const rtt = (t1 - t0) / 2;
      serverOffset = r.epochMs + rtt - t1;
    } catch (_) {}
  }
  syncTime();
  setInterval(syncTime, 60_000);
  setInterval(() => {
    const d = new Date(Date.now() + serverOffset);
    document.getElementById('serverTime').textContent = d.toLocaleTimeString('en-GB', { hour12: false });
  }, 1000);

  // -------- socket --------
  socket.on('connect', () => {
    socket.emit('register', { ownerKey });
  });
  socket.on('errorMsg', ({ message }) => toast(message, 'error'));
  socket.on('registered', () => {});
  socket.on('sessionList', renderSessions);
  socket.on('taskList', renderTasks);
  socket.on('sessionUpdate', () => socket.emit('getSessions'));
  socket.on('pairingCode', ({ code }) => toast(`Pairing: ${code}`, 'success'));
  socket.on('taskUpdate', () => socket.emit('getTasks'));
  socket.on('log', appendLog);
  socket.on('globalLogs', (logs) => {
    logBox.innerHTML = '';
    logs.forEach(appendLog);
  });
  socket.on('taskLog', ({ taskId, message, type, ts }) => {
    if (currentModalTaskId === taskId) {
      appendModalLog({ message, type, ts });
    }
  });

  // -------- tabs --------
  document.querySelectorAll('.tab').forEach(btn => {
    btn.onclick = () => {
      document.querySelectorAll('.tab').forEach(b => b.classList.toggle('active', b === btn));
      document.querySelectorAll('.panel').forEach(p => p.classList.toggle('active', p.id === 'tab-' + btn.dataset.tab));
    };
  });

  // copy key
  document.getElementById('copyKey').onclick = () => {
    navigator.clipboard.writeText(ownerKey).then(() => toast('Key copied', 'success'));
  };

  // -------- sessions --------
  document.getElementById('createSessionBtn').onclick = () => {
    const phoneNumber = document.getElementById('phoneNumber').value.trim();
    if (!phoneNumber) return toast('Enter phone number', 'error');
    socket.emit('createSession', { phoneNumber });
    document.getElementById('phoneNumber').value = '';
  };

  document.getElementById('lookupLogout').onclick = () => {
    const id = document.getElementById('sessionLookup').value.trim().toUpperCase();
    if (!id) return toast('Enter session ID', 'error');
    socket.emit('logoutSession', { sessionId: id });
  };
  document.getElementById('lookupDelete').onclick = () => {
    const id = document.getElementById('sessionLookup').value.trim().toUpperCase();
    if (!id) return toast('Enter session ID', 'error');
    socket.emit('deleteSession', { sessionId: id });
  };

  const sessionListEl = document.getElementById('sessionList');
  const taskSessionSelect = document.getElementById('taskSession');
  let cachedSessions = [];
  let cachedTasks = [];

  function renderSessions(list) {
    cachedSessions = list || [];
    taskSessionSelect.innerHTML = cachedSessions.length
      ? cachedSessions.map(s => `<option value="${s.id}" ${s.status === 'connected' ? '' : 'disabled'}>${s.id} • ${s.phoneNumber} (${s.status})</option>`).join('')
      : '<option value="">No sessions</option>';

    sessionListEl.innerHTML = cachedSessions.length
      ? cachedSessions.map(s => `
        <div class="item">
          <div class="item-head">
            <span class="item-title">${s.id}</span>
            <span class="badge ${s.status}">${s.status}</span>
          </div>
          <div class="item-meta">
            <span>📱 ${s.phoneNumber}</span>
            <span>Created ${new Date(s.createdAt).toLocaleString()}</span>
          </div>
          ${s.pairingCode ? `<div class="pairing">${s.pairingCode}</div>` : ''}
          <div class="item-actions">
            <button class="warn" data-act="logout" data-id="${s.id}">Logout</button>
            <button class="danger" data-act="delete" data-id="${s.id}">Delete</button>
          </div>
        </div>
      `).join('')
      : '<div class="item"><span class="muted">No sessions yet</span></div>';
  }

  sessionListEl.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    const id = btn.dataset.id;
    if (btn.dataset.act === 'logout') socket.emit('logoutSession', { sessionId: id });
    if (btn.dataset.act === 'delete') {
      if (confirm(`Delete session ${id}?`)) socket.emit('deleteSession', { sessionId: id });
    }
  });

  // -------- tasks --------
  document.getElementById('startTaskBtn').onclick = () => {
    const sessionId = taskSessionSelect.value;
    const targetJid = document.getElementById('taskTarget').value.trim();
    const prefix = document.getElementById('taskPrefix').value.trim();
    const delaySec = document.getElementById('taskDelay').value;
    const messages = document.getElementById('taskMessages').value.split('\n').map(x => x.trim()).filter(Boolean);

    if (!sessionId) return toast('Select session', 'error');
    if (!targetJid) return toast('Enter target JID', 'error');
    if (!messages.length) return toast('Enter messages', 'error');

    socket.emit('createTask', { sessionId, targetJid, messages, prefix, delaySec });
  };

  document.getElementById('stopLookup').onclick = () => {
    const id = document.getElementById('taskLookup').value.trim().toUpperCase();
    if (!id) return toast('Enter task ID', 'error');
    socket.emit('stopTask', { taskId: id });
  };

  const taskListEl = document.getElementById('taskList');

  function fmtMs(ms) {
    const s = Math.floor(ms / 1000);
    const h = String(Math.floor(s / 3600)).padStart(2, '0');
    const m = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
    const ss = String(s % 60).padStart(2, '0');
    return `${h}:${m}:${ss}`;
  }

  function renderTasks(list) {
    cachedTasks = list || [];
    taskListEl.innerHTML = cachedTasks.length
      ? cachedTasks.map(t => `
        <div class="item">
          <div class="item-head">
            <span class="item-title">${t.id}</span>
            <span class="badge ${t.status}">${t.status}</span>
          </div>
          <div class="item-meta">
            <span>🎯 ${t.targetJid}</span>
            <span>🧵 ${t.sessionId}</span>
            <span>📨 ${t.sentCount} sent</span>
            <span>🔁 Round ${t.roundCount}</span>
            <span>⏱ ${fmtMs((t.endTime || Date.now()) - t.startTime)}</span>
          </div>
          <div class="item-actions">
            ${t.status === 'running' ? `<button class="danger" data-act="stop" data-id="${t.id}">Stop</button>` : ''}
            <button class="ghost" data-act="logs" data-id="${t.id}">Logs</button>
          </div>
        </div>
      `).join('')
      : '<div class="item"><span class="muted">No tasks yet</span></div>';
  }

  taskListEl.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    const id = btn.dataset.id;
    if (btn.dataset.act === 'stop') socket.emit('stopTask', { taskId: id });
    if (btn.dataset.act === 'logs') openTaskModal(id);
  });

  // refresh times every second
  setInterval(() => {
    if (cachedTasks.length) renderTasks(cachedTasks);
  }, 5000);

  // -------- modal --------
  const modal = document.getElementById('modal');
  const modalBody = document.getElementById('modalBody');
  const modalTitle = document.getElementById('modalTitle');
  let currentModalTaskId = null;

  document.getElementById('modalClose').onclick = () => {
    modal.classList.add('hidden');
    currentModalTaskId = null;
  };

  function openTaskModal(taskId) {
    currentModalTaskId = taskId;
    modalTitle.textContent = `Task ${taskId}`;
    modalBody.innerHTML = '<span class="muted">Loading…</span>';
    modal.classList.remove('hidden');
    socket.emit('getTask', { taskId });
  }

  socket.on('taskInfo', (info) => {
    if (info.id !== currentModalTaskId) return;
    modalTitle.textContent = `Task ${info.id} — ${info.status}`;
    modalBody.innerHTML = `
      <div>🎯 ${info.targetJid}</div>
      <div>🧵 Session: ${info.sessionId}</div>
      <div>📨 Sent: ${info.sentCount} | Round: ${info.roundCount} | Total msgs: ${info.totalMessages}</div>
      <hr style="border-color:rgba(255,32,80,0.2); margin: 10px 0;" />
      <div id="modalLogs"></div>
    `;
    const mLogs = document.getElementById('modalLogs');
    (info.logs || []).forEach(l => mLogs.appendChild(buildLogLine(l)));
    mLogs.scrollTop = mLogs.scrollHeight;
  });

  function appendModalLog(entry) {
    const mLogs = document.getElementById('modalLogs');
    if (!mLogs) return;
    mLogs.appendChild(buildLogLine(entry));
    mLogs.scrollTop = mLogs.scrollHeight;
  }

  // -------- live logs --------
  const logBox = document.getElementById('logBox');
  function buildLogLine(entry) {
    const div = document.createElement('div');
    div.className = `log-line ${entry.type || 'info'}`;
    const ts = new Date(entry.ts).toLocaleTimeString('en-GB', { hour12: false });
    div.innerHTML = `<span class="ts">${ts}</span>${escapeHtml(entry.message)}`;
    return div;
  }
  function appendLog(entry) {
    logBox.appendChild(buildLogLine(entry));
    while (logBox.childElementCount > 500) logBox.firstChild.remove();
    logBox.scrollTop = logBox.scrollHeight;
  }
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // -------- stars --------
  const cvs = document.getElementById('stars');
  const ctx = cvs.getContext('2d');
  let W, H, stars = [], shooters = [];
  function resize() {
    W = cvs.width = window.innerWidth;
    H = cvs.height = window.innerHeight;
    stars = Array.from({ length: 140 }, () => ({
      x: Math.random() * W, y: Math.random() * H,
      r: Math.random() * 1.4 + 0.3,
      a: Math.random(), da: Math.random() * 0.02 + 0.005,
      hue: Math.random() < 0.7 ? 0 : 340,
    }));
  }
  resize();
  window.addEventListener('resize', resize);

  function drawStars() {
    ctx.clearRect(0, 0, W, H);
    for (const s of stars) {
      s.a += s.da;
      if (s.a > 1 || s.a < 0) s.da *= -1;
      ctx.beginPath();
      ctx.fillStyle = `hsla(${s.hue}, 100%, 75%, ${Math.abs(s.a) * 0.9})`;
      ctx.shadowBlur = 8;
      ctx.shadowColor = `hsla(${s.hue}, 100%, 60%, 0.8)`;
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.shadowBlur = 0;
    if (Math.random() < 0.01) shooters.push({ x: Math.random() * W, y: 0, vx: 4 + Math.random() * 6, vy: 3 + Math.random() * 4, life: 60 });
    shooters = shooters.filter(sh => {
      sh.x += sh.vx; sh.y += sh.vy; sh.life--;
      ctx.strokeStyle = `rgba(255, 100, 130, ${sh.life / 60})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(sh.x, sh.y);
      ctx.lineTo(sh.x - sh.vx * 8, sh.y - sh.vy * 8);
      ctx.stroke();
      return sh.life > 0;
    });
    requestAnimationFrame(drawStars);
  }
  drawStars();

  // -------- horror ambience (Web Audio, no file) --------
  let audioCtx = null;
  let ambienceOn = false;
  let nodes = [];
  document.getElementById('soundBtn').onclick = async () => {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') await audioCtx.resume();

    if (ambienceOn) {
      nodes.forEach(n => { try { n.stop?.(); n.disconnect?.(); } catch (_) {} });
      nodes = [];
      ambienceOn = false;
      document.getElementById('soundBtn').textContent = '🔇 sound';
      return;
    }
    ambienceOn = true;
    document.getElementById('soundBtn').textContent = '🔊 sound on';

    // Low drone
    const drone = audioCtx.createOscillator();
    const droneGain = audioCtx.createGain();
    drone.type = 'sine';
    drone.frequency.value = 55;
    droneGain.gain.value = 0.035;
    drone.connect(droneGain).connect(audioCtx.destination);
    drone.start();
    nodes.push(drone);

    // Eerie high sine with slow LFO
    const eerie = audioCtx.createOscillator();
    const eerieGain = audioCtx.createGain();
    eerie.type = 'sawtooth';
    eerie.frequency.value = 312;
    eerieGain.gain.value = 0.008;
    eerie.connect(eerieGain).connect(audioCtx.destination);
    eerie.start();
    nodes.push(eerie);

    const lfo = audioCtx.createOscillator();
    const lfoGain = audioCtx.createGain();
    lfo.frequency.value = 0.15;
    lfoGain.gain.value = 40;
    lfo.connect(lfoGain).connect(eerie.frequency);
    lfo.start();
    nodes.push(lfo);

    // Random creepy blips
    const blipInterval = setInterval(() => {
      if (!ambienceOn) return clearInterval(blipInterval);
      const o = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      o.type = 'triangle';
      o.frequency.value = 200 + Math.random() * 600;
      g.gain.value = 0.0001;
      g.gain.exponentialRampToValueAtTime(0.03, audioCtx.currentTime + 0.05);
      g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 1.2);
      o.connect(g).connect(audioCtx.destination);
      o.start();
      o.stop(audioCtx.currentTime + 1.3);
    }, 4500);
    nodes.push({ stop: () => clearInterval(blipInterval), disconnect: () => {} });
  };

  // group fetch helper (optional)
  window.fetchGroups = () => socket.emit('getGroups');
  socket.on('groupList', (list) => {
    toast(`Fetched ${list.length} groups — first: ${list[0]?.subject || '-'}`, 'success');
  });
})();
