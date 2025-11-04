class ExternalService {
  static ONE_MEGA_BYTE = 1_048_576.0;

  constructor() {
    this.batchNum = 0;
  }

  call(batch) {
    this.batchNum += 1;
    this.prettyPrint(batch);
  }

  prettyPrint(batch) {
    const products = JSON.parse(batch);
    const batchSize = Buffer.byteLength(batch, 'utf8');
    const sizeMB = batchSize / ExternalService.ONE_MEGA_BYTE;

    console.log(`\x1b[1mReceived batch${this.batchNum.toString().padStart(4)}\x1b[22m`);
    console.log(`Size: ${sizeMB.toFixed(2).padStart(10)}MB`);
    console.log(`Products: ${products.length.toString().padStart(8)}`);
    console.log('\n');
  }
}

module.exports = ExternalService;
