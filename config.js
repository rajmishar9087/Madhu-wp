module.exports = {
  APP_NAME: 'Madhu Mishra',
  APP_OWNER: 'Madhu Mishra',
  APP_VERSION: '2.0.0',
  PORT: process.env.PORT || 3000,
  START_TIME: Date.now(),

  SESSION_ROOT: './sessions',
  BACKUP_ROOT: './session_backups',

  MAX_SESSIONS_PER_USER: 5,
  MAX_TASKS_PER_USER: 20,
  MAX_TOTAL_SESSIONS: 60,
  MAX_TOTAL_TASKS: 250,

  MAX_TASK_LOGS: 100,
  MAX_GLOBAL_LOGS: 2000,

  LOG_RETENTION_MS: 30 * 60 * 1000,          // 30 min live logs
  TASK_RETENTION_MS: 2 * 60 * 60 * 1000,     // stopped tasks -> delete after 2h
  SESSION_RETENTION_MS: 6 * 60 * 60 * 1000,  // logged-out sessions -> delete after 6h
  CLEANUP_INTERVAL_MS: 5 * 60 * 1000,        // 5 min
  BACKUP_INTERVAL_MS: 6 * 60 * 60 * 1000,    // 6h

  DEFAULT_DELAY_SEC: 5,
};
