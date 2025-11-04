const fs = require('fs');
const XmlStream = require('xml-stream');
const ExternalService = require('./external_service');
const config = require('./config');
const Logger = require('./logger');

const MAX_BATCH_SIZE = config.maxBatchSize;
const BUFFER_SIZE = config.bufferSize;

class ProductFeedProcessor {
  constructor(xmlFilePath, options = {}) {
    this.xmlFilePath = xmlFilePath;
    this.externalService = options.externalService || new ExternalService();
    this.logger = options.logger || new Logger(config.logLevel);
    this.currentBatch = [];
    this.currentBatchSize = 0;
    this.productsProcessed = 0;
    this.batchesSent = 0;
    this.isShuttingDown = false;
    this.skippedProducts = 0;
    this.errors = [];

    // Progress tracking
    this.lastProgressUpdate = Date.now();
    this.progressInterval = 5000; // Update every 5 seconds

    // Rate limiting
    this.lastBatchSentTime = 0;
    this.minBatchInterval = options.minBatchInterval || 0; // ms between batches
  }

  extractProductData(item) {
    // Extract data, handling both namespaced and non-namespaced fields
    // Google Merchant feeds can have fields like <g:id> or <id>
    const product = {
      id: item['g:id'] || item.id || '',
      title: item.title || '',
      description: item['g:description'] || item.description || item.summary || ''
    };

    // Clean up the data (remove extra whitespace, handle CDATA)
    Object.keys(product).forEach(key => {
      if (typeof product[key] === 'string') {
        product[key] = product[key].trim();
      } else if (product[key] && typeof product[key] === 'object' && product[key].$text) {
        product[key] = product[key].$text.trim();
      }
    });

    return product;
  }

  calculateBatchSize(batch) {
    // Calculate the byte size of the JSON string
    return Buffer.byteLength(JSON.stringify(batch), 'utf8');
  }

  async sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async sendBatchWithRetry(batchJson, batchNumber) {
    const maxRetries = config.maxRetries;
    let lastError;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        // Rate limiting: ensure minimum time between batches
        if (this.minBatchInterval > 0) {
          const timeSinceLastBatch = Date.now() - this.lastBatchSentTime;
          if (timeSinceLastBatch < this.minBatchInterval) {
            await this.sleep(this.minBatchInterval - timeSinceLastBatch);
          }
        }

        this.externalService.call(batchJson);
        this.lastBatchSentTime = Date.now();

        // Success - log and track metrics
        const batchSize = Buffer.byteLength(batchJson, 'utf8');
        const productCount = JSON.parse(batchJson).length;
        this.logger.recordBatch(batchSize, productCount);

        if (config.showProgress) {
          this.logger.info('Batch sent successfully', {
            batchNumber,
            products: productCount,
            sizeMB: (batchSize / (1024 * 1024)).toFixed(2),
            attempt: attempt + 1
          });
        }

        return; // Success
      } catch (error) {
        lastError = error;
        this.logger.warn('Batch send failed', {
          batchNumber,
          attempt: attempt + 1,
          maxRetries,
          error: error.message
        });

        if (attempt < maxRetries - 1) {
          // Exponential backoff: 1s, 2s, 4s, etc.
          const backoffMs = config.retryDelay * Math.pow(2, attempt);
          this.logger.debug('Retrying after backoff', { backoffMs });
          await this.sleep(backoffMs);
        }
      }
    }

    // All retries failed
    this.logger.error('Batch send failed after all retries', {
      batchNumber,
      error: lastError.message
    });
    this.errors.push({
      batchNumber,
      error: lastError.message,
      timestamp: new Date().toISOString()
    });

    // In production, this would go to a dead letter queue
    throw new Error(`Failed to send batch ${batchNumber} after ${maxRetries} attempts: ${lastError.message}`);
  }

  async sendBatch() {
    if (this.currentBatch.length === 0) return;

    this.batchesSent++;
    const batchJson = JSON.stringify(this.currentBatch);

    try {
      await this.sendBatchWithRetry(batchJson, this.batchesSent);
    } finally {
      // Always reset batch, even if send fails
      this.currentBatch = [];
      this.currentBatchSize = 0;
    }
  }

  showProgress() {
    if (!config.showProgress) return;

    const now = Date.now();
    if (now - this.lastProgressUpdate >= this.progressInterval) {
      const memUsage = process.memoryUsage();
      this.logger.info('Processing progress', {
        productsProcessed: this.productsProcessed,
        batchesSent: this.batchesSent,
        currentBatchSize: this.currentBatch.length,
        skippedProducts: this.skippedProducts,
        memoryUsageMB: (memUsage.heapUsed / (1024 * 1024)).toFixed(2)
      });
      this.lastProgressUpdate = now;
    }
  }

  async addProductToBatch(product) {
    // Try adding the product to see if it fits
    const testBatch = [...this.currentBatch, product];
    const testSize = this.calculateBatchSize(testBatch);

    // If adding this product would exceed the limit, send current batch first
    if (testSize >= MAX_BATCH_SIZE - BUFFER_SIZE && this.currentBatch.length > 0) {
      await this.sendBatch();
    }

    // Add product to the (now empty or existing) batch
    this.currentBatch.push(product);
    this.currentBatchSize = this.calculateBatchSize(this.currentBatch);
    this.productsProcessed++;

    // Show progress periodically
    this.showProgress();
  }

  async process() {
    this.logger.startMetrics();
    this.logger.info('Starting XML feed processing', {
      filePath: this.xmlFilePath,
      maxBatchSize: MAX_BATCH_SIZE,
      bufferSize: BUFFER_SIZE
    });

    return new Promise((resolve, reject) => {
      const stream = fs.createReadStream(this.xmlFilePath);
      const xml = new XmlStream(stream);
      const pendingOperations = [];

      // Preserve child nodes as we need to extract nested elements
      xml.preserve('item', true);
      xml.preserve('entry', true);

      // Handle both RSS <item> and Atom <entry> formats
      xml.on('endElement: item', (item) => {
        if (this.isShuttingDown) {
          xml.pause();
          return;
        }

        const product = this.extractProductData(item);
        if (product.id && product.title) {
          // Track async operation
          const operation = this.addProductToBatch(product).catch(error => {
            this.logger.error('Error adding product to batch', {
              productId: product.id,
              error: error.message
            });
          });
          pendingOperations.push(operation);
        } else {
          this.skippedProducts++;
          this.logger.debug('Skipping product without id or title', {
            id: product.id || 'missing',
            title: product.title || 'missing'
          });
        }
      });

      xml.on('endElement: entry', (entry) => {
        if (this.isShuttingDown) {
          xml.pause();
          return;
        }

        const product = this.extractProductData(entry);
        if (product.id && product.title) {
          const operation = this.addProductToBatch(product).catch(error => {
            this.logger.error('Error adding product to batch', {
              productId: product.id,
              error: error.message
            });
          });
          pendingOperations.push(operation);
        } else {
          this.skippedProducts++;
        }
      });

      xml.on('end', async () => {
        try {
          // Wait for all pending operations to complete
          await Promise.all(pendingOperations);

          // Send any remaining products in the final batch
          await this.sendBatch();

          this.logger.info('Processing complete', {
            productsProcessed: this.productsProcessed,
            batchesSent: this.batchesSent,
            skippedProducts: this.skippedProducts,
            errors: this.errors.length
          });

          this.logger.logMetrics();

          console.log(`\nProcessing complete! Total products processed: ${this.productsProcessed}`);

          if (this.errors.length > 0) {
            this.logger.warn('Processing completed with errors', {
              errorCount: this.errors.length,
              errors: this.errors
            });
          }

          resolve();
        } catch (error) {
          this.logger.error('Error during final batch send', { error: error.message });
          reject(error);
        }
      });

      xml.on('error', (error) => {
        this.logger.error('XML parsing error', { error: error.message });
        reject(error);
      });
    });
  }

  async shutdown() {
    this.logger.info('Graceful shutdown initiated');
    this.isShuttingDown = true;

    // Send current batch if any
    if (this.currentBatch.length > 0) {
      this.logger.info('Sending partial batch before shutdown', {
        products: this.currentBatch.length
      });
      await this.sendBatch();
    }

    this.logger.info('Shutdown complete', {
      productsProcessed: this.productsProcessed,
      batchesSent: this.batchesSent
    });
  }
}

// Main execution
if (require.main === module) {
  const xmlFilePath = process.argv[2];

  if (!xmlFilePath) {
    console.error('Usage: node assignment.js <path-to-xml-file>');
    console.error('Environment variables:');
    console.error('  MAX_BATCH_SIZE - Maximum batch size in bytes (default: 5MB)');
    console.error('  MAX_RETRIES - Maximum retry attempts (default: 3)');
    console.error('  LOG_LEVEL - Logging level: error, warn, info, debug (default: info)');
    console.error('  SHOW_PROGRESS - Show progress updates (default: true)');
    process.exit(1);
  }

  if (!fs.existsSync(xmlFilePath)) {
    console.error(`Error: File not found: ${xmlFilePath}`);
    process.exit(1);
  }

  // Check file size upfront
  const stats = fs.statSync(xmlFilePath);
  const fileSizeMB = (stats.size / (1024 * 1024)).toFixed(2);
  console.log(`Processing XML file: ${xmlFilePath} (${fileSizeMB}MB)`);

  const processor = new ProductFeedProcessor(xmlFilePath);
  let isProcessing = true;

  // Graceful shutdown handlers
  const gracefulShutdown = async (signal) => {
    if (!isProcessing) return;

    console.log(`\n${signal} received. Initiating graceful shutdown...`);
    try {
      await processor.shutdown();
      console.log('Graceful shutdown complete');
      process.exit(0);
    } catch (error) {
      console.error('Error during shutdown:', error);
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));

  // Handle uncaught errors
  process.on('uncaughtException', (error) => {
    console.error('Uncaught exception:', error);
    gracefulShutdown('UNCAUGHT_EXCEPTION').then(() => process.exit(1));
  });

  process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled rejection at:', promise, 'reason:', reason);
    gracefulShutdown('UNHANDLED_REJECTION').then(() => process.exit(1));
  });

  // Start processing
  processor.process()
    .then(() => {
      isProcessing = false;
      console.log('Done!');
      process.exit(0);
    })
    .catch((error) => {
      isProcessing = false;
      console.error('Fatal error:', error);
      if (processor.errors.length > 0) {
        console.error('\nErrors encountered during processing:');
        processor.errors.forEach((err, idx) => {
          console.error(`  ${idx + 1}. Batch ${err.batchNumber}: ${err.error}`);
        });
      }
      process.exit(1);
    });
}

module.exports = ProductFeedProcessor;
