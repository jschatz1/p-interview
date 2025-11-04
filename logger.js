const config = require('./config');

const LOG_LEVELS = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3
};

class Logger {
  constructor(level = 'info') {
    this.level = LOG_LEVELS[level] || LOG_LEVELS.info;
    this.metrics = {
      startTime: null,
      productsProcessed: 0,
      batchesSent: 0,
      errors: 0,
      totalBytesProcessed: 0
    };
  }

  log(level, message, meta = {}) {
    if (LOG_LEVELS[level] <= this.level) {
      const logEntry = {
        timestamp: new Date().toISOString(),
        level,
        message,
        ...meta
      };

      // For production, this would go to a logging service
      // For now, pretty print for development
      if (level === 'error') {
        console.error(JSON.stringify(logEntry));
      } else {
        console.log(JSON.stringify(logEntry));
      }
    }
  }

  error(message, meta) {
    this.metrics.errors++;
    this.log('error', message, meta);
  }

  warn(message, meta) {
    this.log('warn', message, meta);
  }

  info(message, meta) {
    this.log('info', message, meta);
  }

  debug(message, meta) {
    this.log('debug', message, meta);
  }

  startMetrics() {
    this.metrics.startTime = Date.now();
  }

  recordBatch(batchSize, productCount) {
    this.metrics.batchesSent++;
    this.metrics.productsProcessed += productCount;
    this.metrics.totalBytesProcessed += batchSize;
  }

  getMetrics() {
    const elapsed = Date.now() - this.metrics.startTime;
    return {
      ...this.metrics,
      elapsedMs: elapsed,
      productsPerSecond: this.metrics.productsProcessed / (elapsed / 1000),
      averageBatchSize: this.metrics.totalBytesProcessed / this.metrics.batchesSent
    };
  }

  logMetrics() {
    if (config.enableMetrics && this.metrics.startTime) {
      const metrics = this.getMetrics();
      this.info('Processing metrics', metrics);
    }
  }
}

module.exports = Logger;
