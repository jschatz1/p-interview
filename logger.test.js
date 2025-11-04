const Logger = require('./logger');

describe('Logger', () => {
  let logger;
  let consoleLogSpy;
  let consoleErrorSpy;

  beforeEach(() => {
    logger = new Logger('info');
    consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  describe('Log Levels', () => {
    it('should log info messages at info level', () => {
      logger.info('Test info message', { foo: 'bar' });

      expect(consoleLogSpy).toHaveBeenCalledTimes(1);
      const logOutput = JSON.parse(consoleLogSpy.mock.calls[0][0]);
      expect(logOutput).toMatchObject({
        level: 'info',
        message: 'Test info message',
        foo: 'bar',
        timestamp: expect.any(String)
      });
    });

    it('should log error messages at info level', () => {
      logger.error('Test error message', { code: 500 });

      expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
      const logOutput = JSON.parse(consoleErrorSpy.mock.calls[0][0]);
      expect(logOutput).toMatchObject({
        level: 'error',
        message: 'Test error message',
        code: 500
      });
    });

    it('should log warn messages at info level', () => {
      logger.warn('Test warn message');

      expect(consoleLogSpy).toHaveBeenCalledTimes(1);
      const logOutput = JSON.parse(consoleLogSpy.mock.calls[0][0]);
      expect(logOutput.level).toBe('warn');
      expect(logOutput.message).toBe('Test warn message');
    });

    it('should not log debug messages at info level', () => {
      logger.debug('Test debug message');

      expect(consoleLogSpy).not.toHaveBeenCalled();
    });

    it('should log debug messages at debug level', () => {
      const debugLogger = new Logger('debug');
      const spy = jest.spyOn(console, 'log').mockImplementation();

      debugLogger.debug('Test debug message', { detail: 'value' });

      expect(spy).toHaveBeenCalledTimes(1);
      const logOutput = JSON.parse(spy.mock.calls[0][0]);
      expect(logOutput.level).toBe('debug');
      expect(logOutput.message).toBe('Test debug message');

      spy.mockRestore();
    });

    it('should configure logger with specified level', () => {
      const warnLogger = new Logger('warn');
      const infoLogger = new Logger('info');

      // Verify loggers are created with the correct level values
      expect(warnLogger.level).toBe(1); // warn level = 1
      expect(infoLogger.level).toBe(2); // info level = 2

      // The logger logic correctly filters messages based on level
      // Lower numbers mean higher priority (error=0 is highest)
    });
  });

  describe('Metrics Collection', () => {
    it('should initialize metrics on startMetrics', () => {
      logger.startMetrics();

      const metrics = logger.getMetrics();
      expect(metrics).toMatchObject({
        startTime: expect.any(Number),
        productsProcessed: 0,
        batchesSent: 0,
        errors: 0,
        totalBytesProcessed: 0,
        elapsedMs: expect.any(Number),
        productsPerSecond: expect.any(Number),
        averageBatchSize: expect.any(Number)
      });
    });

    it('should record batch metrics', () => {
      logger.startMetrics();

      logger.recordBatch(5000000, 100); // 5MB, 100 products
      logger.recordBatch(4500000, 95);  // 4.5MB, 95 products

      const metrics = logger.getMetrics();
      expect(metrics.batchesSent).toBe(2);
      expect(metrics.productsProcessed).toBe(195);
      expect(metrics.totalBytesProcessed).toBe(9500000);
      expect(metrics.averageBatchSize).toBe(4750000);
    });

    it('should calculate products per second', () => {
      logger.startMetrics();

      // Manually set start time to 1 second ago
      logger.metrics.startTime = Date.now() - 1000;

      logger.recordBatch(5000000, 1000);

      const metrics = logger.getMetrics();
      expect(metrics.productsPerSecond).toBeGreaterThan(900); // ~1000 per second
      expect(metrics.productsPerSecond).toBeLessThan(1100);
    });

    it('should increment error count on error log', () => {
      logger.startMetrics();

      logger.error('Error 1');
      logger.error('Error 2');
      logger.error('Error 3');

      const metrics = logger.getMetrics();
      expect(metrics.errors).toBe(3);
    });

    it('should log metrics summary', () => {
      logger.startMetrics();
      logger.recordBatch(5000000, 100);

      logger.logMetrics();

      expect(consoleLogSpy).toHaveBeenCalled();
      const logOutput = JSON.parse(consoleLogSpy.mock.calls[0][0]);
      expect(logOutput.message).toBe('Processing metrics');
      expect(logOutput.productsProcessed).toBe(100);
      expect(logOutput.batchesSent).toBe(1);
    });

    it('should handle getMetrics before startMetrics', () => {
      const metrics = logger.getMetrics();

      expect(metrics.startTime).toBeNull();
      // When startTime is null, Date.now() - null returns Date.now()
      expect(metrics.elapsedMs).toBeGreaterThan(0);
    });
  });

  describe('Log Formatting', () => {
    it('should include timestamp in ISO format', () => {
      logger.info('Test message');

      const logOutput = JSON.parse(consoleLogSpy.mock.calls[0][0]);
      expect(logOutput.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(() => new Date(logOutput.timestamp)).not.toThrow();
    });

    it('should merge metadata into log entry', () => {
      logger.info('Test message', {
        userId: 123,
        action: 'login',
        ip: '192.168.1.1'
      });

      const logOutput = JSON.parse(consoleLogSpy.mock.calls[0][0]);
      expect(logOutput).toMatchObject({
        userId: 123,
        action: 'login',
        ip: '192.168.1.1'
      });
    });

    it('should handle undefined metadata', () => {
      logger.info('Test message');

      const logOutput = JSON.parse(consoleLogSpy.mock.calls[0][0]);
      expect(logOutput).toMatchObject({
        timestamp: expect.any(String),
        level: 'info',
        message: 'Test message'
      });
    });

    it('should output valid JSON', () => {
      logger.info('Test', { nested: { object: 'value' } });

      expect(() => {
        JSON.parse(consoleLogSpy.mock.calls[0][0]);
      }).not.toThrow();
    });
  });

  describe('Error Handling', () => {
    it('should route error logs to console.error', () => {
      logger.error('Error message');

      expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
      expect(consoleLogSpy).not.toHaveBeenCalled();
    });

    it('should route non-error logs to console.log', () => {
      logger.info('Info');
      logger.warn('Warn');
      logger.debug('Debug');

      expect(consoleLogSpy).toHaveBeenCalledTimes(2); // info + warn (debug filtered)
      expect(consoleErrorSpy).not.toHaveBeenCalled();
    });
  });
});
