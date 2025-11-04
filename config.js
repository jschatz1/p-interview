module.exports = {
  // Batch size configuration
  maxBatchSize: parseInt(process.env.MAX_BATCH_SIZE) || 5 * 1024 * 1024, // 5MB default
  bufferSize: parseInt(process.env.BUFFER_SIZE) || 1024, // 1KB safety buffer

  // Processing configuration
  maxRetries: parseInt(process.env.MAX_RETRIES) || 3,
  retryDelay: parseInt(process.env.RETRY_DELAY) || 1000, // milliseconds

  // Logging configuration
  logLevel: process.env.LOG_LEVEL || 'info', // error, warn, info, debug
  enableMetrics: process.env.ENABLE_METRICS !== 'false',

  // Performance
  showProgress: process.env.SHOW_PROGRESS !== 'false',
  memoryCheckInterval: parseInt(process.env.MEMORY_CHECK_INTERVAL) || 10000 // ms
};
