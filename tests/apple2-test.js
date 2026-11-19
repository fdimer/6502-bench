// Apple II Plus model checks with a synthetic ROM (no Apple code): node tests/apple2-test.js
// With A2_ROMS set to a folder of the Apple II Plus ROM images, it also boots the real ROMs and runs BASIC.
const fs = require('fs'), path = require('path');
const src = f => fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8').replace(/if \(typeof module[^\n]*/, '');
const T = {}; eval(['m6502core.js', 'm6502asm.js', 'memchips.js', 'a2disk.js', 'apple2.js'].map(src).join('\n') + '\nObject.assign(T, { assemble, AppleMachine, A2, A2_SOCKETS, a2Render, a2TapeFromBytes, a2TapeFromSamples, a2WavFromTape, a2dLoad, a2dSave, a2dEncode62, a2dDecode62 });');
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
// ---- the 50 Hz Eurapple scanning (Sather 3-11): preset 011001000, 312 lines ----
{ const e = new T.AppleMachine(); e.setEuro(true);
  ok(e.FT === 20280 && Math.abs(A2.CPU_HZ / e.FT - 50.32) < 0.01, 'Eurapple: 312 lines, 20,280 cycles a frame, 50.32 Hz');
  ok(e.vState(256 * 65) === 0xC8 && e.vState(311 * 65) === 0xFF, 'Eurapple: lines 256-311 count 011001000-011111111'); }
// ---- the language card (slot 0) ----
{ const l = new T.AppleMachine(); l.loadRom(0xF800, new Uint8Array(0x800).fill(0x42)); l.lc = true; l.reset(true);
  const rd = a => l.read(a), wr = (a, v) => l.write(a, v);
  ok(rd(0xF800) === 0x42, 'language card after RESET: the ROMs are read');
  wr(0xF800, 0x99); rd(0xC080); ok(rd(0xF800) === 0x99, 'after RESET writes go to its RAM; C080h reads it back');
  rd(0xC08B); rd(0xC08B); wr(0xD000, 0x11); rd(0xC083); rd(0xC083); wr(0xD000, 0x22);
  rd(0xC088); const b1 = rd(0xD000); rd(0xC080); const b2 = rd(0xD000);
  ok(b1 === 0x11 && b2 === 0x22, 'two 4K banks at D000h: bank 1 (C08Bh) and bank 2 (C083h)');
  rd(0xC080); wr(0xE000, 0x77); ok(rd(0xE000) !== 0x77, 'an even address write-protects the RAM');
  rd(0xC081); ok(rd(0xF800) === 0x42, 'C081h: the ROMs are read again'); }
// ---- cassette: a tape made from bytes, its polarity changes, and the WAV file ----
{ const tp = T.a2TapeFromBytes([0x00, 0xFF], 0.01), n = tp.length, dif = i => tp[i] - tp[i - 1];
  ok(dif(1) === 650 && dif(n - 45) === 250, 'tape: header half cycles of 650 cycles, 0 bits of 250');
  const wav = T.a2WavFromTape(tp), pcm = new Float32Array((wav.length - 44) / 2); for (let i = 0; i < pcm.length; i++) pcm[i] = ((wav[44 + 2 * i] | wav[45 + 2 * i] << 8) << 16 >> 16) / 32768;
  const back = T.a2TapeFromSamples(pcm, 44100);
  ok(Math.abs(back.length - tp.length) <= 1, 'tape to WAV and back: ' + back.length + ' polarity changes of ' + tp.length); }
// ---- Disk II: the 6-and-2 encoding, a disk image to tracks and back, and the controller as a program reads it ----
{ const img = new Uint8Array(143360); for (let i = 0; i < img.length; i++) img[i] = (i * 7 + (i >> 8)) & 255;
  const sec = img.subarray(0, 256), enc = T.a2dEncode62(sec), dec = T.a2dDecode62(enc);
  ok(enc.length === 343 && dec && dec.every((v, i) => v === sec[i]), '6-and-2: 256 bytes to 343 nibbles and back');
  const disk = T.a2dLoad('test.dsk', img), back = T.a2dSave(disk);
  ok(!back.bad.length && back.bytes.every((v, i) => v === img[i]), '.dsk to 35 tracks of nibbles and back, every sector');
  const po = T.a2dSave(T.a2dLoad('test.po', img)); ok(!po.bad.length && po.bytes.every((v, i) => v === img[i]), '.po (ProDOS order) to tracks and back');
  // a program that reads a sector through the controller in slot 6, as the boot ROM does: find the address field
  // of sector 2 on track 0, then copy the data field's 343 nibbles to 1000h; then it writes sector 3 back from 1200h
  const r = T.assemble(`
  .org $F800
reset:  ldx #$60
        lda $C0E9       ; motor on
        lda $C0EE       ; Q7 low: read
fa:     jsr nib
        cmp #$D5
        bne fa
        jsr nib
        cmp #$AA
        bne fa
        jsr nib
        cmp #$96
        bne fa
        jsr nib
        jsr nib         ; volume
        jsr nib
        jsr nib         ; track
        jsr nib
        sta $20
        jsr nib
        sec
        rol $20
        and $20         ; sector
        cmp #2
        bne fa
fd:     jsr nib
        cmp #$D5
        bne fd
        jsr nib
        jsr nib         ; AA AD
        ldy #0
l1:     lda $C0EC
        bpl l1
        sta $1000,y
        iny
        bne l1
l2:     lda $C0EC
        bpl l2
        sta $1100,y
        iny
        cpy #$57
        bne l2
; write: wait for the address field of sector 3, then write the data field from 1200h (FF FF D5 AA AD, 343, DE AA EB)
wa:     jsr nib
        cmp #$D5
        bne wa
        jsr nib
        cmp #$AA
        bne wa
        jsr nib
        cmp #$96
        bne wa
        ldy #4          ; volume, track
sk:     jsr nib
        dey
        bne sk
        jsr nib
        sta $20
        jsr nib
        sec
        rol $20
        and $20
        cmp #3
        bne wa
        ldy #5
sk2:    jsr nib
        dey
        bne sk2         ; the checksum, DE AA EB
        lda $C0ED       ; Q6 high
        lda $C0EE       ; Q7 low: sense write protect
        lda #$FF
        sta $C0EF       ; Q7 high, load the data register
        ora $C0EC       ; shift it out
        ldy #0
w1:     lda $1200,y
        sta $C0ED
        ora $C0EC
        iny
        bne w1
w2:     lda $1300,y
        sta $C0ED
        ora $C0EC
        iny
        cpy #$61
        bne w2
        lda $C0EE       ; Q7 low
        lda $C0EC
        lda $C0E8       ; motor off
done:   jmp done
nib:    lda $C0EC
        bpl nib
        rts
  .org $FFFC
  .word reset
`);
  const im2 = new Uint8Array(0x800); for (const c of r.chunks) im2.set(c.bytes, c.addr - 0xF800);
  const dm = new T.AppleMachine(); dm.loadRom(0xF800, im2); dm.diskOn = true; dm.disk.insert(0, 'test.dsk', img);
  const fresh = new Uint8Array(256).fill(0x5A); fresh[0] = 1; fresh[255] = 0xEE;
  const wbuf = [0xFF, 0xFF, 0xD5, 0xAA, 0xAD, ...T.a2dEncode62(fresh), 0xDE, 0xAA, 0xEB]; dm.ram.set(wbuf, 0x1200);
  dm.reset(true); dm.run(400000);
  const got = T.a2dDecode62(Array.from(dm.ram.slice(0x1000, 0x1157)));
  const s2 = img.subarray((0 * 16 + [0x0, 0x7, 0xE, 0x6, 0xD, 0x5, 0xC, 0x4, 0xB, 0x3, 0xA, 0x2, 0x9, 0x1, 0x8, 0xF][2]) * 256, (0 * 16 + 0xE) * 256 + 256);
  ok(got && got.every((v, i) => v === s2[i]), 'a 6502 loop reads physical sector 2 of track 0 through the controller (DOS sector 14)');
  const saved = T.a2dSave(dm.disk.drives[0].disk);
  const at3 = (0 * 16 + 0x6) * 256;
  ok(!saved.bad.length && saved.bytes.subarray(at3, at3 + 256).every((v, i) => v === fresh[i]) && dm.disk.drives[0].dirty, 'it writes physical sector 3 (DOS sector 6); the disk saves back with the new data and every sector readable');
}
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
  // the cassette: the Monitor writes 0300h-030Fh, reads it back from the recording and from a tape made from the bytes
  const sec = n => a.run(A2.FRAME_T * 60 * n);
  a.type('CALL -151\n'); sec(0.5); for (let i = 0; i < 16; i++) a.ram[0x300 + i] = i * 17 + 3;
  const data = a.ram.slice(0x300, 0x310), same = () => a.ram.slice(0x300, 0x310).every((v, i) => v === data[i]);
  a.startRec(); a.type('300.30FW\n'); sec(12); const rec = a.stopRec();
  ok(rec.length > 15000, 'the Monitor\'s W toggles the cassette output: ' + rec.length + ' times');
  a.ram.fill(0, 0x300, 0x310); a.type('300.30FR\n'); sec(0.3); a.playTape(rec); sec(12);
  ok(same() && !a.screenText().some(l => l.includes('ERR')), 'R reads the recording back');
  a.ram.fill(0, 0x300, 0x310); a.type('300.30FR\n'); sec(0.3); a.playTape(T.a2TapeFromBytes(data, 10)); sec(12);
  ok(same() && !a.screenText().some(l => l.includes('ERR')), 'R reads a tape made from the bytes');
  // Applesoft SAVE and LOAD through a recording
  a.type('\x03\nNEW\n10 PRINT "TAPE"\n'); sec(1); a.startRec(); a.type('SAVE\n'); sec(25); const bas = a.stopRec();
  a.type('NEW\n'); sec(0.5); a.type('LOAD\n'); sec(0.3); a.playTape(bas); sec(25); a.type('LIST\n'); sec(1);
  ok(a.basicListing()[0] === '10 PRINT "TAPE"', 'Applesoft SAVE, then NEW and LOAD from the recording: ' + (a.basicListing()[0] || 'nothing'));
} else console.log('(A2_ROMS not set: the checks with the ROMs were skipped)');
console.log(fails ? fails + ' failed' : 'all passed'); process.exit(fails ? 1 : 0);
