// PET model checks with a synthetic ROM (no Commodore code): node tests/pet-test.js
const fs = require('fs'), path = require('path');
const src = f => fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8').replace(/if \(typeof module[^\n]*/, '');
const T = {}; eval(['m6502core.js', 'm6502asm.js', 'm6821.js', 'm6522.js', 'memchips.js', 'pet.js'].map(src).join('\n') + '\nT.assemble=assemble;T.PETMachine=PETMachine;T.PET=PET;T.M6522=M6522;');
let fails = 0; const ok = (c, m) => { if (!c) { fails++; console.log('FAIL', m); } else console.log('ok  ', m); };
// A stand-in kernal: enables the retrace interrupt on PIA 1 CB1, puts "A" on the screen, then scans keyboard row 6.
const r = T.assemble(`
  .org $F000
reset:  ldx #$FF
        txs
        lda #$0F        ; PIA 1 port A: PA0-3 outputs (keyboard row)
        sta $E810       ; control register is clear after reset, so this is the data direction register
        lda #$04
        sta $E811       ; now address the port itself
        lda #$05        ; CRB: port selected, CB1 interrupt on the falling edge, enabled
        sta $E813
        lda #$01        ; screen code for A
        sta $8000
        sta $8400       ; the screen RAM repeats every 1K
        lda #$06
        sta $E810       ; keyboard row 6
        cli
loop:   lda $E812       ; read the columns
        sta $10
        jmp loop
irq:    pha
        lda $E812       ; reading port B clears the retrace flag
        inc $11
        pla
        rti
  .org $FFFA
  .word reset, reset, irq
`);
ok(!r.errors || !r.errors.length, 'test ROM assembles' + (r.errors && r.errors.length ? ': ' + JSON.stringify(r.errors[0]) : ''));
const m = new T.PETMachine();
for (const c of r.chunks) m.rom.set(c.bytes, c.addr); for (const s of ['UD6', 'UD7', 'UD8', 'UD9']) m.fitted[s] = true;
for (let i = 0; i < 8; i++) m.chargen[8 + i] = m.chargen[1024 + 8 + i] = 0x81;      // character 1: left and right columns lit
m.hasChargen = true; m.reset();
m.run(T.PET.LINE_T * T.PET.LINES * 10 + 2000);
ok(m.vram[0] === 1 && m.read(0x8400) === 1, 'screen RAM at 8000h, repeated at 8400h');
ok(m.ram[0x11] === 10, 'ten retrace interrupts in ten frames (got ' + m.ram[0x11] + ')');
const B = T.PET.BORDER, px = (x, y) => m.fb[(y + B) * T.PET.FW + B + x];
ok(px(0, 0) === 1 && px(7, 3) === 1 && px(3, 3) === 0 && px(8, 0) === 0, 'character drawn from the character generator');
m.vram[0] = 0x81; m.draw(); ok(px(0, 0) === 0 && px(3, 3) === 1, 'bit 7 of the screen code shows the character reversed');
ok(m.ram[0x10] === 0xFF, 'no key: row reads FFh');
m.key('Return', true); m.run(200); ok(m.ram[0x10] === 0xDF, 'RETURN is row 6 bit 5, active low (got ' + m.ram[0x10].toString(16) + ')');
m.key('Return', false); m.key('A', true); m.run(200); ok(m.ram[0x10] === 0xFF, 'a key in another row is not seen');
ok(m.read(0x9000) === 0x90 && m.read(0x7FFF) === 0, 'empty ROM socket reads the address high byte; RAM reads back');
m.setRam(8); ok(m.read(0x2000) === 0x20, '8K machine: no RAM at 2000h');
const v = new T.M6522(); v.write(14, 0xC0); v.write(4, 10); v.write(5, 0); v.tick(11); ok(!v.irq(), 'VIA timer 1 not yet timed out'); v.tick(1); ok(v.irq(), 'VIA timer 1 interrupts after N+1.5 cycles');
v.read(4); ok(!v.irq(), 'reading the timer clears the interrupt');
v.write(12, 0x0E); ok(v.ca2() === 1, 'VIA CA2 manual output high (lower-case character set)'); v.write(12, 0x0C); ok(v.ca2() === 0, 'VIA CA2 manual output low');
v.write(8, 20); v.write(11, 0x10); v.write(10, 0x0F); let flips = 0, last = v.cb2(); for (let i = 0; i < 2000; i++) { v.tick(1); if (v.cb2() !== last) { flips++; last = v.cb2(); } }
ok(flips >= 10 && flips <= 14, 'shift register free-runs on CB2 (sound): ' + flips + ' edges in 2000 cycles');
const prg = new Uint8Array([0x01, 0x04, 0x07, 0x04, 0x0A, 0x00, 0x80, 0x00, 0x00, 0x00]); m.setRam(32); const res = m.loadPrg(prg);
ok(res.ok && res.basic && m.ram[0x0401] === 0x07 && (m.ram[0x2A] | m.ram[0x2B] << 8) === 0x0409, '.prg loads at 0401h and sets the end-of-program pointers');
// lines and the two kinds of fault (a line held, a pin disconnected)
{ const z = new T.PETMachine(); for (const c of r.chunks) z.loadRom(c.addr, new Uint8Array(c.bytes)); z.reset();
  const N = z.nets();
  ok(N.D3.pins.length === 8 && N.BA11.pins.length === 6 && N.BA10.pins.length === 7 && N.FA0.pins.length === 16 && N.RD3.pins.join() === 'UI6,DIN,UI6,DOUT,UJ6,DIN,UJ6,DOUT', 'PET lines: D3 joins the 6502 and the seven ROM sockets; BA11 the six 4K ROMs; FA0 all sixteen RAMs; RD3 the two chips of bit 3');
  z.ram[0x10] = 0x5A; const r0 = z.read(0xF000);
  z.setNetFault('RD3', 1); ok(z.read(0x10) === 0x5A && z.read(0x11) === (z.ram[0x11] | 8) && z.read(0xF000) === r0, 'RD3 held high: RAM reads have bit 3 set, ROM reads do not');
  z.clearFaults(); z.setNetFault('D3', 0); ok(z.read(0x10) === 0x52 && z.read(0xF000) === (r0 & 0xF7), "D3 held low: every byte the 6502 reads loses bit 3");
  ok(z.chipById.UD9.f.D3 === 0 && z.cpuC.f.D3 === 0, 'the held line shows on every pin on it');
  z.clearFaults(); z.setPinFault('UJ6', 'DOUT', 0); z.ram[0x4010] = 0xFF; ok(z.read(0x4010) === 0xF7 && z.read(0x10) === 0x5A, 'one RAM chip\'s DOUT disconnected at low: only its bank loses bit 3');
  z.clearFaults(); ok(z.read(0x10) === 0x5A && !z.fx, 'clearing the faults restores the machine');
  z.setPinFault('UC4', 'A15', 0); ok(z.read(0x8010) === 0x5A && z.busA(0x8010) === 0x10, '6502 A15 stuck low: 8010h reads RAM at 0010h');
  z.clearFaults(); z.setPinFault('UC4', 'RW', 'z'); z.write(0x20, 0x77); z.clearFaults(); ok(z.read(0x20) !== 0x77, '6502 R/W disconnected (floats high): writes are lost');
  z.setNetFault('CAS0', 1); ok(z.read(0x10) === 0xFF, 'CAS0 held high: the lower bank is out of circuit'); z.clearFaults();
  z.setPinFault('UC4', 'PHI0', 0); ok(/clock/.test(z.held()) && z.cpu.step()[0].held, '6502 PHI0 stuck: the processor is held'); z.clearFaults(); ok(z.held() === null, 'and runs again once cleared');
  z.setPinFault('UC4', 'IRQ', 0); z.syncIrq(); ok(z.cpu.irqLine, '6502 IRQ stuck low: the interrupt line is on'); z.clearFaults(); z.syncIrq(); ok(!z.cpu.irqLine, 'and off again');
  z.setNetFault('FA2', 0); z.setPinFault('UD9', 'CS', 1); ok(z.faultList().length === 2 && z.chipFaults('UI9').join() === 'A2: line held low', 'faults are listed as lines and as pins');
  z.clearChip('UI9'); ok(z.faultList().length === 1, "clearing a chip's faults releases the lines its pins are on"); }
console.log(fails ? fails + ' FAILED' : 'all passed'); process.exit(fails ? 1 : 0);
