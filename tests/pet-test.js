// PET model checks with a synthetic ROM (no Commodore code): node tests/pet-test.js
const fs = require('fs'), path = require('path');
const src = f => fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8').replace(/if \(typeof module[^\n]*/, '');
const T = {}; eval(['m6502core.js', 'm6502asm.js', 'm6821.js', 'm6522.js', 'pet.js'].map(src).join('\n') + '\nT.assemble=assemble;T.PETMachine=PETMachine;T.PET=PET;T.M6522=M6522;');
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
console.log(fails ? fails + ' FAILED' : 'all passed'); process.exit(fails ? 1 : 0);
