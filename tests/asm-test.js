// Assembles every documented opcode (written the way the disassembler prints it) and checks the bytes;
// then a sample program, zero-page selection and error messages.
// Usage: node tests/asm-test.js
const fs = require('fs'), path = require('path');
const src = f => fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8').replace(/if \(typeof module[^\n]*/, '');
const T = {}; eval(src('m6502core.js') + '\n' + src('m6502asm.js') + '\nT.assemble=assemble;T.disasm=disasm;T.OPS=OPS6502;');
let n = 0, bad = 0;
T.OPS.forEach((e, op) => {
  if (!e) return;
  const bytes = [op, 0x34, 0x12];
  if (['zp', 'zpx', 'zpy', 'izx', 'izy', 'imm', 'rel'].includes(e[1])) bytes[2] = 0;
  const mem = new Uint8Array(65536); mem.set(bytes, 0x0400);
  const d = T.disasm(a => mem[a], 0x0400);
  const r = T.assemble('  .org $0400\n  ' + d.text);
  const got = r.chunks[0] ? r.chunks[0].bytes : [];
  const exp = bytes.slice(0, d.len);
  n++;
  if (r.errors.length || got.join() !== exp.join()) { bad++; console.log('FAIL', d.text, JSON.stringify(r.errors), got, exp); }
});
console.log(n, 'opcodes,', bad, 'failures');
const prog = `
IO      = $6000
count   = $10
        * = $8000
reset   ldx #$FF
        txs
        lda #<msg
        sta $20
        lda #>msg
        sta $21
        ldy #0
loop:   lda ($20),y
        beq done
        sta IO
        iny
        bne loop
done    inc count
        lda later,x
        sta later
        jmp (vec)
later:  .byte 1,2,"AB",'C'
vec     .word reset
msg     .text "HI",0
        .res 2,$EA
        .org $FFFC
        .word reset, reset
`;
const r = T.assemble(prog);
console.log('errors', r.errors);
const mem = new Uint8Array(65536); for (const c of r.chunks) mem.set(c.bytes, c.addr);
let a = 0x8000; while (a < 0x8022) { const d = T.disasm(x => mem[x], a); console.log(a.toString(16), d.text); a += d.len; }
console.log('FFFC:', mem[0xFFFC].toString(16), mem[0xFFFD].toString(16), '| chunks', r.chunks.map(c => c.addr.toString(16) + '+' + c.bytes.length).join(' '));
const e = T.assemble('  bne far\n  .res 200\nfar nop\n  lda #300\n  foo\n  lda undefined_label\n  stx $1234,x');
console.log(e.errors);
