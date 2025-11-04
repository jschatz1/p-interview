const fs = require('fs');
const path = require('path');
const ProductFeedProcessor = require('./assignment');
const ExternalService = require('./external_service');

describe('ProductFeedProcessor', () => {
  let processor;
  let mockExternalService;
  let mockLogger;

  beforeEach(() => {
    mockExternalService = {
      call: jest.fn()
    };
    mockLogger = {
      startMetrics: jest.fn(),
      recordBatch: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
      logMetrics: jest.fn()
    };
  });

  describe('extractProductData', () => {
    beforeEach(() => {
      processor = new ProductFeedProcessor('dummy.xml', { logger: mockLogger });
    });

    it('should extract basic product data', () => {
      const item = {
        'g:id': 'PROD123',
        'title': 'Test Product',
        'g:description': 'This is a test product description'
      };

      const result = processor.extractProductData(item);

      expect(result).toEqual({
        id: 'PROD123',
        title: 'Test Product',
        description: 'This is a test product description'
      });
    });

    it('should handle non-namespaced fields', () => {
      const item = {
        'id': 'PROD456',
        'title': 'Another Product',
        'description': 'Another description'
      };

      const result = processor.extractProductData(item);

      expect(result).toEqual({
        id: 'PROD456',
        title: 'Another Product',
        description: 'Another description'
      });
    });

    it('should trim whitespace from fields', () => {
      const item = {
        'g:id': '  PROD789  ',
        'title': '  Product with spaces  ',
        'g:description': '  Description with spaces  '
      };

      const result = processor.extractProductData(item);

      expect(result).toEqual({
        id: 'PROD789',
        title: 'Product with spaces',
        description: 'Description with spaces'
      });
    });

    it('should handle objects with $text property', () => {
      const item = {
        'g:id': { $text: 'PROD999' },
        'title': { $text: 'Complex Product' },
        'g:description': { $text: 'Complex description' }
      };

      const result = processor.extractProductData(item);

      expect(result).toEqual({
        id: 'PROD999',
        title: 'Complex Product',
        description: 'Complex description'
      });
    });

    it('should handle missing fields with empty strings', () => {
      const item = {
        'title': 'Product Without ID'
      };

      const result = processor.extractProductData(item);

      expect(result).toEqual({
        id: '',
        title: 'Product Without ID',
        description: ''
      });
    });
  });

  describe('calculateBatchSize', () => {
    beforeEach(() => {
      processor = new ProductFeedProcessor('dummy.xml', { logger: mockLogger });
    });

    it('should calculate correct byte size for empty batch', () => {
      const size = processor.calculateBatchSize([]);
      expect(size).toBe(2); // JSON.stringify([]) = "[]"
    });

    it('should calculate correct byte size for single product', () => {
      const batch = [{ id: 'A', title: 'B', description: 'C' }];
      const expectedSize = Buffer.byteLength(JSON.stringify(batch), 'utf8');

      const size = processor.calculateBatchSize(batch);
      expect(size).toBe(expectedSize);
    });

    it('should calculate correct byte size for multiple products', () => {
      const batch = [
        { id: 'ID1', title: 'Product 1', description: 'Description 1' },
        { id: 'ID2', title: 'Product 2', description: 'Description 2' },
        { id: 'ID3', title: 'Product 3', description: 'Description 3' }
      ];
      const expectedSize = Buffer.byteLength(JSON.stringify(batch), 'utf8');

      const size = processor.calculateBatchSize(batch);
      expect(size).toBe(expectedSize);
    });

    it('should handle unicode characters correctly', () => {
      const batch = [
        { id: '1', title: 'Café ☕', description: 'Résumé 日本語' }
      ];
      const expectedSize = Buffer.byteLength(JSON.stringify(batch), 'utf8');

      const size = processor.calculateBatchSize(batch);
      expect(size).toBe(expectedSize);
      expect(size).toBeGreaterThan(JSON.stringify(batch).length); // UTF-8 bytes > char count
    });
  });

  describe('sendBatch', () => {
    beforeEach(() => {
      processor = new ProductFeedProcessor('dummy.xml', {
        externalService: mockExternalService,
        logger: mockLogger
      });
    });

    it('should send batch to external service', async () => {
      const expectedBatch = [
        { id: 'P1', title: 'Product 1', description: 'Desc 1' },
        { id: 'P2', title: 'Product 2', description: 'Desc 2' }
      ];
      processor.currentBatch = expectedBatch;

      await processor.sendBatch();

      expect(mockExternalService.call).toHaveBeenCalledTimes(1);
      const sentData = mockExternalService.call.mock.calls[0][0];
      expect(JSON.parse(sentData)).toEqual(expectedBatch);
    });

    it('should reset current batch after sending', async () => {
      processor.currentBatch = [
        { id: 'P1', title: 'Product 1', description: 'Desc 1' }
      ];

      await processor.sendBatch();

      expect(processor.currentBatch).toEqual([]);
      expect(processor.currentBatchSize).toBe(0);
    });

    it('should not call external service if batch is empty', async () => {
      processor.currentBatch = [];

      await processor.sendBatch();

      expect(mockExternalService.call).not.toHaveBeenCalled();
    });
  });

  describe('addProductToBatch', () => {
    beforeEach(() => {
      processor = new ProductFeedProcessor('dummy.xml', {
        externalService: mockExternalService,
        logger: mockLogger
      });
    });

    it('should add product to empty batch', async () => {
      const product = { id: 'P1', title: 'Product 1', description: 'Desc 1' };

      await processor.addProductToBatch(product);

      expect(processor.currentBatch).toEqual([product]);
      expect(processor.productsProcessed).toBe(1);
    });

    it('should add multiple products to batch', async () => {
      const product1 = { id: 'P1', title: 'Product 1', description: 'Desc 1' };
      const product2 = { id: 'P2', title: 'Product 2', description: 'Desc 2' };

      await processor.addProductToBatch(product1);
      await processor.addProductToBatch(product2);

      expect(processor.currentBatch).toHaveLength(2);
      expect(processor.productsProcessed).toBe(2);
    });

    it('should send batch when size limit is reached', async () => {
      // Create a large product that will fill up most of the batch
      const largeDescription = 'x'.repeat(300000); // ~300KB description

      // Add products until we exceed the limit
      for (let i = 0; i < 20; i++) {
        await processor.addProductToBatch({
          id: `P${i}`,
          title: `Product ${i}`,
          description: largeDescription
        });
      }

      // Should have called sendBatch at least once
      expect(mockExternalService.call).toHaveBeenCalled();
    });

    it('should keep batch size under 5MB', async () => {
      const MAX_BATCH_SIZE = 5 * 1024 * 1024;
      const largeDescription = 'x'.repeat(300000);

      // Track all batches sent
      const sentBatches = [];
      mockExternalService.call.mockImplementation((batch) => {
        sentBatches.push(batch);
      });

      // Add many products
      for (let i = 0; i < 100; i++) {
        await processor.addProductToBatch({
          id: `P${i}`,
          title: `Product ${i}`,
          description: largeDescription
        });
      }

      // Send final batch
      await processor.sendBatch();

      // Check all sent batches are under 5MB
      sentBatches.forEach((batch) => {
        const size = Buffer.byteLength(batch, 'utf8');
        expect(size).toBeLessThan(MAX_BATCH_SIZE);
      });
    });
  });

  describe('XML Processing Integration', () => {
    const testFixturesDir = path.join(__dirname, 'test-fixtures');

    beforeAll(() => {
      // Create test fixtures directory
      if (!fs.existsSync(testFixturesDir)) {
        fs.mkdirSync(testFixturesDir);
      }
    });

    it('should process small RSS feed', async () => {
      const feedPath = path.join(testFixturesDir, 'small-rss.xml');
      const feedContent = `<?xml version="1.0"?>
<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">
  <channel>
    <title>Test Feed</title>
    <item>
      <g:id>ITEM1</g:id>
      <title>Product 1</title>
      <g:description>Description 1</g:description>
    </item>
    <item>
      <g:id>ITEM2</g:id>
      <title>Product 2</title>
      <g:description>Description 2</g:description>
    </item>
  </channel>
</rss>`;

      fs.writeFileSync(feedPath, feedContent);

      processor = new ProductFeedProcessor(feedPath, {
        externalService: mockExternalService,
        logger: mockLogger
      });

      await processor.process();

      expect(mockExternalService.call).toHaveBeenCalledTimes(1);
      const batch = JSON.parse(mockExternalService.call.mock.calls[0][0]);
      expect(batch).toHaveLength(2);
      expect(batch[0]).toEqual({ id: 'ITEM1', title: 'Product 1', description: 'Description 1' });
      expect(batch[1]).toEqual({ id: 'ITEM2', title: 'Product 2', description: 'Description 2' });
    });

    it('should process Atom feed', async () => {
      const feedPath = path.join(testFixturesDir, 'small-atom.xml');
      const feedContent = `<?xml version="1.0"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:g="http://base.google.com/ns/1.0">
  <entry>
    <g:id>ATOM1</g:id>
    <title>Atom Product 1</title>
    <summary>Atom Description 1</summary>
  </entry>
  <entry>
    <g:id>ATOM2</g:id>
    <title>Atom Product 2</title>
    <summary>Atom Description 2</summary>
  </entry>
</feed>`;

      fs.writeFileSync(feedPath, feedContent);

      processor = new ProductFeedProcessor(feedPath, {
        externalService: mockExternalService,
        logger: mockLogger
      });

      await processor.process();

      expect(mockExternalService.call).toHaveBeenCalledTimes(1);
      const batch = JSON.parse(mockExternalService.call.mock.calls[0][0]);
      expect(batch).toHaveLength(2);
      expect(batch[0].id).toBe('ATOM1');
      expect(batch[1].id).toBe('ATOM2');
    });

    it('should skip products without id or title', async () => {
      const feedPath = path.join(testFixturesDir, 'invalid-items.xml');
      const feedContent = `<?xml version="1.0"?>
<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">
  <channel>
    <item>
      <g:id>VALID1</g:id>
      <title>Valid Product</title>
      <g:description>Valid Description</g:description>
    </item>
    <item>
      <title>No ID Product</title>
      <g:description>This should be skipped</g:description>
    </item>
    <item>
      <g:id>NO_TITLE</g:id>
      <g:description>This should also be skipped</g:description>
    </item>
    <item>
      <g:id>VALID2</g:id>
      <title>Another Valid Product</title>
    </item>
  </channel>
</rss>`;

      fs.writeFileSync(feedPath, feedContent);

      processor = new ProductFeedProcessor(feedPath, {
        externalService: mockExternalService,
        logger: mockLogger
      });

      await processor.process();

      const batch = JSON.parse(mockExternalService.call.mock.calls[0][0]);
      expect(batch).toHaveLength(2);
      expect(batch[0].id).toBe('VALID1');
      expect(batch[1].id).toBe('VALID2');
    });
  });
});

describe('ExternalService', () => {
  let service;
  let consoleLogSpy;

  beforeEach(() => {
    service = new ExternalService();
    consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
  });

  it('should increment batch number on each call', () => {
    const batch1 = JSON.stringify([{ id: '1', title: 'P1', description: 'D1' }]);
    const batch2 = JSON.stringify([{ id: '2', title: 'P2', description: 'D2' }]);

    service.call(batch1);
    service.call(batch2);

    expect(service.batchNum).toBe(2);
  });

  it('should log batch information', () => {
    const batch = JSON.stringify([
      { id: '1', title: 'Product 1', description: 'Description 1' },
      { id: '2', title: 'Product 2', description: 'Description 2' }
    ]);

    service.call(batch);

    expect(consoleLogSpy).toHaveBeenCalled();
    expect(consoleLogSpy.mock.calls.some(call =>
      call[0].includes('Received batch')
    )).toBe(true);
  });

  it('should calculate size correctly', () => {
    const batch = JSON.stringify([
      { id: '1', title: 'Product 1', description: 'x'.repeat(1000) }
    ]);

    service.call(batch);

    const sizeCalls = consoleLogSpy.mock.calls.filter(call =>
      call[0].includes('Size:')
    );
    expect(sizeCalls.length).toBeGreaterThan(0);
  });
});
