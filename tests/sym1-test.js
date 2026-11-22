// SYM-1 model checks with a stand-in ROM (no Synertek code): node tests/sym1-test.js
// With SYM_ROMS set to a folder holding SUPERMON (symon1_1.bin, or any file of it), it also runs the real monitor:
// the keypad and display, the serial terminal at two baud rates, both cassette formats and the debug trace.
const fs = require('fs'), path = require('path');
const src = f => fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8').replace(/if \(typeof module[^\n]*/, '');
const T = {}; eval(['m6502core.js', 'm6502asm.js', 'memchips.js', 'm6522.js', 'm6532.js', 'sym1.js'].map(src).join('\n') + '\nObject.assign(T, { assemble, SymMachine, SYM, SYM_KEYS, symTapeHS, symTapeFromSamples, symWavFromTape, M6532 });');
let fails = 0; const ok = (c, m) => { if (!c) { fails++; console.log('FAIL', m); } else console.log('ok  ', m); };

// ---- the 6532 on its own ----
{
  const r = new T.M6532();
  r.writeIO(0x1D, 3); r.tick(8); ok(r.timer === 2 && !r.tFlag, 'RIOT timer at 8T: one count every 8 cycles');
  r.tick(24); ok(r.tFlag && r.timer === 0xFF, 'it passes zero, sets its flag, then counts every cycle');
  r.tick(5); ok(r.timer === 0xFA, '...down from FFh');
  r.writeIO(0x1C, 9); ok(r.irq() === false && r.tIrq, 'writing at A4=1 A3=1 starts it with its interrupt enabled');
  r.ddra = 0x80; r.ora = 0x80; r.edge(); r.writeIO(0x04, 0); r.writeIO(0x00, 0x00); ok(r.readIO(0x05) & 0x40, 'PA7 falling edge sets the edge flag; reading the flags clears it');
  ok(!(r.readIO(0x05) & 0x40), '...cleared');
}

// ---- a stand-in ROM: power-on reset, System RAM at the top of memory, write protection ----
const sr = T.assemble(`
  .org $8000
reset:  ldx #$FF
        txs
        lda #$CC
        sta $A00C       ; VIA 1 PCR: CA2 low ends POR
        lda #$01
        sta $AC01       ; VIA 3 PA0 high: System RAM writable
        sta $AC03
        lda #$5A
        sta $A67C       ; System RAM
        lda #$12
        sta $0300
        lda $FFFC       ; the echo of A67Ch
        sta $0301
        lda #$00
        sta $AC01       ; write protect System RAM
        lda #$77
        sta $A67C
        lda $A67C
        sta $0302
spin:   jmp spin
  .org $8FFC
        .word reset
`);
const m = new T.SymMachine();
const romImg = new Uint8Array(0x1000); for (const c of sr.chunks) romImg.set(c.bytes, c.addr - 0x8000);
m.fitRom('P0', 0x8000, romImg, 'stand-in');
m.reset(true);
ok(m.por(0xFFFC) && m.peek(0xFFFC) === 0x00 && m.peek(0xFFFD) === 0x80, 'power on: POR\' maps the reset vector to 8FFCh in P0');
m.run(2000);
ok(!m.por(0xFFFC), 'writing VIA 1\'s PCR ends POR\'');
ok(m.ram[0x301] === 0x5A, 'System RAM A600h-A67Fh is echoed at F800h-FFFFh (FFFCh reads A67Ch)');
ok(m.ram[0x302] === 0x5A, 'with VIA 3 PA0 low (jumper MM in), System RAM is write protected');
ok(m.peek(0xA010) === m.peek(0xA000) && m.peek(0xA420) === m.peek(0xA400) && m.riot.ram[0x7C] === m.peek(0xA77C), 'partial decoding: VIA 1 every 16 bytes, RIOT I/O every 32, its RAM every 128');
ok(m.peek(0x1000) === 0xFF && m.peek(0x2000) === 0xFF, 'nothing answers at 1000h-7FFFh');
m.setRam(1); ok(m.loadBin(new Uint8Array(2), 0x3FF).ok === false, 'with 1K fitted, RAM ends at 03FFh');
m.setRam(4);
// ---- the keypad matrix: a key joins its row and column ----
m.riot.ddra = 0x80; m.riot.ora = 0x00; m.riot.ddrb = 0x07; m.riot.orb = 0x00;      // SUPERMON's KSCONF: rows low, columns read
m.keyDown('9'); ok((m.riot.pa() & 0x7F) === 0x7B, 'key 9 (row 1, column 2) pulls PA2 low while the rows are driven low');
m.riot.ddra = 0x7F; m.riot.ddrb = 0x00;                                          // LRNKEY: columns low, rows read
ok((m.riot.pb() & 7) === 6, '...and PB0 (row 1) when the columns are driven low');
m.keyUp('9');
// ---- the display: U37 lights digit PB0-PB3 with the segments on port A ----
m.riot.ddra = 0xFF; m.riot.ddrb = 0x3F; m.displayFrame();
const t0 = m.ct; m.riot.writeIO(2, 3); m.riot.writeIO(0, 0x06); m.ct = t0 + 1000; m.riot.writeIO(2, 8);
const f = m.displayFrame(); ok(f[3 * 8 + 1] > 0.9 && f[3 * 8 + 2] > 0.9 && f[3 * 8] === 0, 'digit 3 shows "1" while PB = 3 and PA = 06h');
// ---- the high-speed tape encoder and the WAV round trip ----
{
  const e = T.symTapeHS(new Uint8Array([1, 2]), 0x200, 1, 0.1), w = T.symWavFromTape(e);
  const s = new Float32Array((w.length - 44) / 2); const dv = new DataView(w.buffer); for (let i = 0; i < s.length; i++) s[i] = dv.getInt16(44 + 2 * i, true) / 32768;
  const back = T.symTapeFromSamples(s, 44100);
  ok(Math.abs(back.length - e.length) <= 2 && Math.abs(back[100] - back[99] - (e[100] - e[99])) < 40, 'a tape survives the trip through a WAV file');
}

// ---- the real SUPERMON ----
const R = process.env.SYM_ROMS;
if (R) {
  const files = fs.readdirSync(R), mon = files.find(n => /symon|supermon/i.test(n));
  const s = new T.SymMachine(); s.fitRom('P0', 0x8000, fs.readFileSync(path.join(R, mon)), 'SUPERMON 1.1'); s.reset(true);
  const sec = t => s.run(t * 1e6);
  const shown = () => { sec(0.05); s.displayFrame(); sec(0.03); return s.displayText(); };
  const press = k => { s.keyDown(k); sec(0.06); s.keyUp(k); sec(0.08); };
  sec(0.5);
  press('CR'); ok(shown().startsWith('5Y1.1'), 'RST then a key: SUPERMON shows SY1.1');
  for (const k of ['MEM', '2', '0', '0', 'CR', 'A', '9', 'CR']) press(k);
  ok(s.ram[0x200] === 0xA9, 'MEM 200 CR A9 deposits A9h at 0200h from the keypad');
  for (const k of ['MEM', '2', '0', '0', 'CR']) press(k);
  const d = shown(); ok(d === '0200.A9.', 'and MEM 200 shows 0200 A9 on the display' + (d === '0200.A9.' ? '' : ': ' + d));
  for (const baud of [4800, 300]) {
    s.baud = baud; s.reset(false); sec(0.6); s.takeOutput();
    s.send('Q'); sec(1.5); s.takeOutput();
    const slow = 4800 / baud;
    s.send('M8000\r'); sec(slow);
    const o = s.takeOutput();
    ok(o.includes('8000,4C,') && s.riot.ram[0x51] === { 4800: 1, 300: 0x4C }[baud], `the terminal at ${baud} baud: Q logs on (SDBYT ${s.riot.ram[0x51].toString(16)}h) and M8000 shows 4Ch`);
    s.send('\r'); sec(slow); s.takeOutput();
  }
  s.baud = 4800; s.reset(false); sec(0.6); s.send('Q'); sec(1); s.takeOutput();
  for (let i = 0; i < 32; i++) s.ram[0x200 + i] = (i * 7 + 3) & 0xFF;
  const want = [...s.ram.subarray(0x200, 0x220)];
  for (const [sv, ld, t] of [['S2', 'L2', 12], ['S1', 'L1', 40]]) {
    s.startRec(); s.send(`${sv}01,200,21F\r`); sec(t); s.takeOutput();
    const edges = Float64Array.from(s.stopRec());
    s.ram.fill(0, 0x200, 0x220); s.send(`${ld}01\r`); sec(0.5); s.playTape(edges); sec(t + 2); s.stopTape();
    ok(want.every((v, i) => s.ram[0x200 + i] === v) && s.takeOutput().endsWith('\r\n.'), `${sv} records 0200h-021Fh and ${ld} loads it back (${sv === 'S2' ? 'high-speed' : 'KIM'} format)`);
  }
  const data = Uint8Array.from({ length: 40 }, (_, i) => (i * 13 + 5) & 0xFF), edges = T.symTapeHS(data, 0x300, 7, 2);
  s.send('L207\r'); sec(0.3); s.playTape(edges); sec(edges[edges.length - 1] / 1e6 + 1); s.stopTape(); s.takeOutput();
  ok([...data].every((v, i) => s.ram[0x300 + i] === v), 'L2 loads a tape made by the high-speed encoder');
  s.ram.set([0xA9, 0x05, 0xE8, 0x4C, 0x00, 0x02], 0x200);
  s.keyDown('DEBUG ON'); s.send('G200\r'); sec(1); const a = s.takeOutput(); s.send('G\r'); sec(1); const b = s.takeOutput();
  ok(a.includes('0202,2') && b.includes('0203,2'), 'DEBUG ON: each G runs one instruction and SUPERMON shows the next PC with code 2');
  s.keyDown('DEBUG OFF');
} else console.log('(SYM_ROMS not set: the checks with SUPERMON were skipped)');
console.log(fails ? fails + ' FAILED' : 'all passed');
process.exit(fails ? 1 : 0);
