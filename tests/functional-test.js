// Runs Klaus Dormann's 6502 functional test (6502_functional_test.bin, assembled with
// load_data_direct = 1 and decimal tests enabled) against the CPU core.
// Get it from https://github.com/Klaus2m5/6502_65C02_functional_tests (bin_files folder).
// Usage: node tests/functional-test.js path/to/6502_functional_test.bin [success address, default 3469]
const fs = require('fs'), path = require('path');
const { M6502 } = require(path.join(__dirname, '..', 'src', 'm6502core.js'));
const mem = new Uint8Array(65536);
mem.set(fs.readFileSync(process.argv[2]));
const success = parseInt(process.argv[3] || '3469', 16);
const cpu = new M6502({ read: a => mem[a], write: (a, v) => { mem[a] = v; } });
cpu.pc = 0x0400;
let n = 0, cycles = 0; const t0 = Date.now();
for (;;) {
  const pc = cpu.pc, c = cpu.step();
  if (cpu.pc === pc || cpu.jammed) break; // the test traps by jumping to itself
  n++; cycles += c.length;
}
const ok = cpu.pc === success;
console.log(`${ok ? 'PASSED' : 'FAILED'}: trapped at ${cpu.pc.toString(16).toUpperCase()}h after ${n} instructions, ${cycles} cycles (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
process.exit(ok ? 0 : 1);
