// Checks every documented opcode against Tom Harte's SingleStepTests (65x02/6502/v1):
// registers, memory and every bus cycle (address, data, read/write), dummy accesses included.
// Get the JSON files from https://github.com/SingleStepTests/65x02 (folder 6502/v1).
// Usage: node tests/singlestep-test.js path/to/6502/v1
const fs = require('fs'), path = require('path');
const { M6502, OPS6502 } = require(path.join(__dirname, '..', 'src', 'm6502core.js'));
const dir = process.argv[2];
let total = 0, failed = 0;
for (let op = 0; op < 256; op++) {
  if (!OPS6502[op]) continue;
  const file = path.join(dir, op.toString(16).padStart(2, '0') + '.json');
  const tests = JSON.parse(fs.readFileSync(file, 'utf8'));
  let bad = 0, first = null;
  for (const t of tests) {
    const mem = new Map(t.initial.ram);
    const cpu = new M6502({ read: a => mem.get(a) ?? 0, write: (a, v) => mem.set(a, v) });
    Object.assign(cpu, { pc: t.initial.pc, s: t.initial.s, a: t.initial.a, x: t.initial.x, y: t.initial.y, p: t.initial.p, pollI: true });
    const cyc = cpu.step(), f = t.final;
    let why = null;
    for (const k of ['pc', 's', 'a', 'x', 'y', 'p']) if (cpu[k] !== f[k]) { why = `${k} is ${cpu[k]}, expected ${f[k]}`; break; }
    if (!why) for (const [a, v] of f.ram) if ((mem.get(a) ?? 0) !== v) { why = `memory at ${a}`; break; }
    if (!why && cyc.length !== t.cycles.length) why = `${cyc.length} cycles, expected ${t.cycles.length}`;
    if (!why) t.cycles.forEach(([a, v, k], i) => { if (!why && (cyc[i].a !== a || cyc[i].d !== v || (cyc[i].k === 'R') !== (k === 'read'))) why = `cycle ${i + 1} differs`; });
    if (why) { bad++; first = first || `${t.name}: ${why}`; }
  }
  total += tests.length; failed += bad;
  if (bad) console.log(`${OPS6502[op].join(' ')} (${op.toString(16)}): ${bad} failures, e.g. ${first}`);
}
console.log(`${total} tests across 151 opcodes, ${failed} failures`);
process.exit(failed ? 1 : 0);
