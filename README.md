# Product Feed Batch Processor

[![Node.js CI](https://github.com/jschatz1/p-interview/actions/workflows/node.js.yml/badge.svg)](https://github.com/jschatz1/p-interview/actions/workflows/node.js.yml)
[![codecov](https://codecov.io/gh/jschatz1/p-interview/branch/main/graph/badge.svg)](https://codecov.io/gh/jschatz1/p-interview)

A Node.js application that parses large XML product feeds, extracts product information, and sends batched data to an external service.

## Features

### Core Functionality
- **Streaming XML Parser**: Efficiently handles large XML files (tested with 48MB+ feeds) without loading everything into memory
- **Smart Batching**: Dynamically batches products into JSON arrays that are as close to 5MB as possible while staying strictly below the limit
- **Google Merchant Feed Support**: Handles both RSS (`<item>`) and Atom (`<entry>`) feed formats
- **Field Extraction**: Extracts `id`, `title`, and `description` from each product

### Production-Ready Features
- **Retry Logic**: Automatic retry with exponential backoff (3 retries by default)
- **Graceful Shutdown**: Handles SIGTERM/SIGINT signals to finish processing current batch
- **Progress Tracking**: Real-time progress updates with memory usage monitoring
- **Structured Logging**: JSON-formatted logs with configurable log levels
- **Metrics Collection**: Tracks products processed, batches sent, errors, and performance
- **Rate Limiting**: Configurable minimum interval between batch sends
- **Error Handling**: Comprehensive error tracking with dead letter queue support
- **Configuration Management**: Environment variable-based configuration

## Requirements

- Node.js (v12 or higher recommended)
- npm

## Installation

```bash
npm install
```

## Usage

```bash
node assignment.js <path-to-xml-file>
```

### Example

```bash
node assignment.js feed.xml
```

## Configuration

The application can be configured using environment variables:

```bash
# Maximum batch size in bytes (default: 5MB)
MAX_BATCH_SIZE=5242880

# Maximum retry attempts for failed batches (default: 3)
MAX_RETRIES=3

# Initial retry delay in milliseconds (default: 1000)
# Uses exponential backoff: 1s, 2s, 4s, etc.
RETRY_DELAY=1000

# Logging level: error, warn, info, debug (default: info)
LOG_LEVEL=info

# Show progress updates (default: true)
SHOW_PROGRESS=true

# Enable metrics collection (default: true)
ENABLE_METRICS=true

# Run the processor
node assignment.js feed.xml
```

### Example with Custom Configuration

```bash
# Increase retries and enable debug logging
MAX_RETRIES=5 LOG_LEVEL=debug node assignment.js feed.xml

# Disable progress for cleaner logs in CI/CD
SHOW_PROGRESS=false node assignment.js feed.xml

# Custom batch size (3MB)
MAX_BATCH_SIZE=3145728 node assignment.js feed.xml
```

## Testing

Run the test suite:

```bash
npm test
```

Run tests in watch mode:

```bash
npm run test:watch
```

Run tests with coverage report:

```bash
npm run test:coverage
```

## Code Quality

Lint the code:

```bash
npm run lint
```

Auto-fix linting issues:

```bash
npm run lint:fix
```

### Test Coverage

The test suite includes:

- **Unit Tests**: Product extraction, batch size calculation, batch sending logic
- **Integration Tests**: XML parsing with RSS and Atom feeds
- **Edge Cases**: Invalid data, missing fields, size limit enforcement
- **ExternalService Tests**: Batch number tracking, logging output

## How It Works

1. **Initialization**: Reads configuration from environment variables and initializes logging/metrics
2. **Streaming Parse**: The XML file is parsed using a streaming parser to handle large files efficiently without loading into memory
3. **Product Extraction**: For each product in the feed, the parser extracts:
   - `id` (from `<g:id>` or `<id>`)
   - `title` (from `<title>`)
   - `description` (from `<g:description>`, `<description>`, or `<summary>`)
4. **Dynamic Batching**: Products are accumulated into batches. Before adding each product, the code calculates the JSON byte size to ensure the batch stays below 5MB
5. **Batch Delivery with Retry**: When a batch reaches the size limit:
   - Applies rate limiting if configured
   - Attempts to send batch to `ExternalService`
   - Retries with exponential backoff on failure (up to 3 times)
   - Logs errors and tracks failed batches
6. **Progress Monitoring**: Every 5 seconds, logs progress including products processed, memory usage, and batch count
7. **Final Batch**: Any remaining products are sent when parsing completes
8. **Metrics Report**: Displays final statistics including processing time, products/sec, and any errors
9. **Graceful Shutdown**: Can handle SIGTERM/SIGINT to finish current batch before exiting

## Output

The program displays information for each batch sent:

```
Received batch   1
Size:       4.98MB
Products:     1247

Received batch   2
Size:       4.97MB
Products:     1253

Processing complete! Total products processed: 2500
Done!
```

## Project Structure

```
.
assignment.js          # Main program (streaming parser & batch processor)
external_service.js    # External service that receives batches
package.json          # Dependencies and scripts
README.md            # This file
```

## Implementation Details

- **Max Batch Size**: 5MB (5,242,880 bytes)
- **Buffer**: Small buffer (1KB) to ensure we stay strictly below 5MB
- **Batch Format**: JSON array of objects: `[{id: 'id', title: 'title', description: 'description'}, ...]`
- **Memory Efficient**: Uses streaming to process large files without high memory usage

## Production Features

### Retry Logic & Error Handling
- Automatic retry with exponential backoff (configurable, default 3 attempts)
- Failed batches are tracked and reported
- Supports dead letter queue pattern for production deployment

### Graceful Shutdown
- Handles SIGTERM and SIGINT signals
- Completes current batch before shutting down
- Ensures no data loss during deployment or restart

### Observability
- **Structured Logging**: JSON-formatted logs for easy parsing by log aggregation tools
- **Metrics Collection**: Tracks products/sec, batch sizes, memory usage, errors
- **Progress Tracking**: Real-time updates every 5 seconds
- **Log Levels**: Configurable (error, warn, info, debug)

### Performance
- **Memory Efficient**: Constant memory usage regardless of file size
- **Rate Limiting**: Configurable minimum interval between batch sends
- **Progress Monitoring**: Real-time memory and processing statistics

## Dependencies

### Production
- `xml-stream`: Streaming XML parser built on SAX

### Development
- `jest`: Testing framework
- `eslint`: Code quality and style enforcement
