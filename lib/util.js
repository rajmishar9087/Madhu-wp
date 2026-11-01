function fmtUptime(ms) {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

function safeId(s) {
  return String(s || '').replace(/[^A-Za-z0-9-]/g, '_').slice(0, 64);
}

module.exports = { fmtUptime, safeId };
