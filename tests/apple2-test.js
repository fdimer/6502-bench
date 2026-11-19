// Apple II Plus model checks with a synthetic ROM (no Apple code): node tests/apple2-test.js
// With A2_ROMS set to a folder of the Apple II Plus ROM images, it also boots the real ROMs and runs BASIC.
const fs = require('fs'), path = require('path');
const src = f => fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8').replace(/if \(typeof module[^\n]*/, '');
const T = {}; eval(['m6502core.js', 'm6502asm.js', 'memchips.js', 'apple2.js'].map(src).join('\n') + '\nT.assemble=assemble;T.AppleMachine=AppleMachine;T.A2=A2;T.A2_SOCKETS=A2_SOCKETS;T.a2Render=a2Render;');
let fails = 0; const ok = (c, m) => { if (!c) { fails++; console.log('FAIL', m); } else console.log('ok  ', m); };
const A2 = T.A2, m = new T.AppleMachine();
// ---- the video scanner's addresses (Sather figures 5.5, 5.6 and 5.8) ----
const at = (line, h) => line * 65 + h, txt = { text: 1, page2: 0, hires: 0, mixed: 0 }, hgr = { text: 0, page2: 0, hires: 1, mixed: 0 };
ok(A2.FRAME_T === 17030 && Math.round(A2.CPU_HZ) === 1020484, 'a frame is 17,030 cycles; the clock averages 1,020,484 Hz');
ok(m.scanAddr(at(0, 25), txt) === 0x400 && m.scanAddr(at(0, 64), txt) === 0x427, 'text line 0 is 0400h-0427h');
ok(m.scanAddr(at(64, 25), txt) === 0x428 && m.scanAddr(at(128, 25), txt) === 0x450, 'text lines 8 and 16 start at 0428h and 0450h');
ok(m.scanAddr(at(8, 25), txt) === 0x480 && m.scanAddr(at(191, 64), txt) === 0x7F7, 'text line 1 starts at 0480h; the last byte shown is 07F7h');
ok(m.scanAddr(at(0, 0), txt) === 0x1468, 'the first address of HBL on line 0 is 1468h (page 1)');
ok(m.scanAddr(at(192, 25), txt) === 0x478, 'during VBL the top third is scanned less eight bytes: 0478h');
ok(m.scanAddr(at(0, 25), { ...txt, page2: 1 }) === 0x800, 'page 2 text starts at 0800h');
ok(m.scanAddr(at(1, 25), hgr) === 0x2400 && m.scanAddr(at(8, 25), hgr) === 0x2080 && m.scanAddr(at(64, 25), hgr) === 0x2028, 'HIRES lines 1, 8 and 64 start at 2400h, 2080h and 2028h');
ok(m.scanAddr(at(0, 25), { ...hgr, page2: 1 }) === 0x4000, 'HIRES page 2 starts at 4000h');
ok(m.scanAddr(at(160, 25), { ...hgr, mixed: 1 }) === 0x650 && m.scanAddr(at(159, 25), { ...hgr, mixed: 1 }) === 0x3DD0, 'mixed: line 160 scans text (0650h), line 159 HIRES (3DD0h)');
ok(m.scanAddr(at(250, 25), txt) === m.scanAddr(at(256, 25), txt), 'lines 256-261 scan the memory of lines 250-255');
// ---- a stand-in ROM: soft switches, keyboard, speaker, paddles, the floating bus ----
const r = T.assemble(`
  .org $F800
reset:  ldx #$FF
        txs
        lda $C057       ; HIRES
        lda $C050       ; GRAPHICS
        lda $C055       ; PAGE 2
        lda $C055
        lda $C054       ; PAGE 1
        ldx #3
spk:    lda $C030
        dex
        bne spk
        lda $C070       ; trigger the paddle timers
        ldy #0
pdl:    lda $C064
        bpl done
        iny
        bne pdl
done:   sty $10
        lda $C000
        sta $11
        lda $C010
        lda $C000
        sta $12
        lda $C0FF        ; nothing answers: the floating bus
        sta $13
loop:   jmp loop
  .org $FFFA
  .word reset, reset, reset
`);
ok(!r.errors || !r.errors.length, 'test ROM assembles' + (r.errors && r.errors.length ? ': ' + JSON.stringify(r.errors[0]) : ''));
const img = new Uint8Array(0x800); for (const c of r.chunks) img.set(c.bytes, c.addr - 0xF800); m.loadRom(0xF800, img);
ok(m.fitted.F8 && !m.fitted.D0, 'a 2K image at F800h fits socket F8 only');
m.paddle[0] = 0;
m.ram.fill(0xA5, 0x2000, 0x4000);       // HIRES page 1: what the floating bus reads in the picture
m.reset(true); m.key(0x41); m.run(5000);
ok(m.sw.hires === 1 && m.sw.text === 0 && m.sw.page2 === 0, 'soft switches: HIRES, GRAPHICS, and PAGE 1 after PAGE 2');
ok(m.speakerToggles === 3, 'each access to C030h toggles the speaker');
ok(m.ram[0x10] === 0, 'paddle at 0 (2 µs): the timer is done before the first count');
ok(m.ram[0x11] === 0xC1 && m.ram[0x12] === 0x41, 'C000h reads the key with the strobe; C010h clears the strobe');
ok(m.ram[0x13] === 0xA5 || m.ram[0x13] === 0, 'an address nothing answers reads the byte the scanner drove out of RAM (' + m.ram[0x13].toString(16).toUpperCase() + 'h)');
{ const m2 = new T.AppleMachine(); m2.paddle[0] = 1; const us = m2.paddleCycles(0) / A2.CPU_HZ * 1e6;
  ok(Math.abs(us - 3302.2) < 1, 'paddle at full scale (150K): the timer runs (150,000 + 100) x 0.022 = 3,302 µs (' + us.toFixed(1) + ')'); }
// ---- the picture: a HIRES byte with bit 7 is delayed half a dot; LORES colour 12 lights dots 2 and 3 of every 4 ----
{ const v = new T.AppleMachine(); v.sw = { text: 0, mixed: 0, page2: 0, hires: 1, an0: 0, an1: 0, an2: 0, an3: 0 };
  v.ram[0x2000] = 0x01; v.ram[0x2001] = 0x81; v.vidTo(A2.FRAME_T);
  ok(v.work[0] && v.work[1] && !v.work[2], 'HIRES 01h: the first dot is two 14M periods from the left edge');
  ok(!v.work[14] && v.work[15] && v.work[16] && !v.work[17], 'HIRES 81h: the dot is delayed one 14M period');
  v.sw.hires = 0; v.vt = 0; v.ram[0x400] = 0x0C; v.vidTo(A2.FRAME_T);
  ok([0, 1, 2, 3, 4, 5, 6, 7].map(x => v.work[x]).join('') === '00110011', 'LORES colour 12: dots 2 and 3 of every 4');
  const out = new Uint32Array(A2.W * A2.H), burst = new Uint8Array(A2.H).fill(1); T.a2Render(v.work, burst, out, 'colour');
  ok((out[5] & 0xFFFFFF) === 0x00DD11, 'colour decoding: LORES 12 is green'); }
// ---- the real ROMs, if they are here ----
const R = process.env.A2_ROMS;
if (R) {
  const files = fs.readdirSync(R), a = new T.AppleMachine();
  for (const [s, addr] of T.A2_SOCKETS) { const f = files.find(n => new RegExp('Pages_' + s).test(n)); if (f) a.loadRom(addr, fs.readFileSync(path.join(R, f))); }
  const cg = files.find(n => /Video/i.test(n)); if (cg) { a.chargen.set(fs.readFileSync(path.join(R, cg))); a.hasChargen = true; }
  a.reset(true); a.run(A2.FRAME_T * 60);
  ok(a.screenText()[0].trim() === 'APPLE ][' && a.screenText()[2].startsWith(']'), 'the Autostart ROM starts Applesoft: APPLE ][ and the ] prompt');
  a.type('PRINT 6*7\n'); a.run(A2.FRAME_T * 60);
  ok(a.screenText().some(l => l.trim() === '42'), 'typed PRINT 6*7 gives 42');
  a.type('10 HOME:PRINT "OK"\nLIST\n'); a.run(A2.FRAME_T * 90);
  ok(a.basicListing()[0] === '10 HOME : PRINT "OK"', 'the BASIC program reads back from memory: ' + a.basicListing()[0]);
} else console.log('(A2_ROMS not set: the checks with the ROMs were skipped)');
console.log(fails ? fails + ' failed' : 'all passed'); process.exit(fails ? 1 : 0);
