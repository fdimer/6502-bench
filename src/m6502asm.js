// ---- 6502 assembler (two-pass) ----
// Syntax: LDA #$10 / LDA $10 / LDA $1234,X / LDA ($10),Y / LDA ($10,X) / JMP ($1234) / ASL A
// Numbers: $1F 0x1F 1Fh %1010 42 'A'; * = current address; <expr low byte, >expr high byte.
// Labels: "name:" anywhere, or a bare name in column 1. Directives (dot optional):
// ORG / *=, EQU / =, BYTE DB DFB TEXT ASCII, WORD DW, DS RES, END.
const ASM_OPS = (() => {
  const t = new Map();
  OPS6502.forEach((e, op) => { if (e) t.set(e[0] + ' ' + e[1], op); });
  return t;
})();
const MNEMONICS = new Set(OPS6502.filter(Boolean).map(e => e[0]));
const DIRECTIVES = new Set(['ORG', 'EQU', 'BYTE', 'DB', 'DFB', 'DCB', 'TEXT', 'ASCII', 'WORD', 'DW', 'DS', 'RES', 'END']);

class AsmError extends Error {}

function asmSplit(s, sep) { // split at top level (outside quotes/parens)
  const out = []; let depth = 0, q = null, cur = '';
  for (const ch of s) {
    if (q) { cur += ch; if (ch === q) q = null; continue; }
    if (ch === '"' || ch === "'") { q = ch; cur += ch; continue; }
    if (ch === '(') depth++; else if (ch === ')') depth--;
    if (ch === sep && depth === 0) { out.push(cur); cur = ''; continue; }
    cur += ch;
  }
  out.push(cur);
  return out.map(x => x.trim());
}
function stripComment(s) {
  let q = null;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (q) { if (ch === q) q = null; continue; }
    if (ch === '"' || ch === "'") { q = ch; continue; }
    if (ch === ';') return s.slice(0, i);
  }
  return s;
}

// returns { v, known } — known is false if any label was undefined (pass 1)
function asmEval(expr, syms, pc, strict) {
  const src = expr.trim();
  let i = 0, known = true;
  const ws = () => { while (i < src.length && /\s/.test(src[i])) i++; };
  const fail = m => { throw new AsmError(m); };
  function primary() {
    ws();
    const ch = src[i];
    if (ch === '(') { i++; const v = bor(); ws(); if (src[i] !== ')') fail('missing )'); i++; return v; }
    if (ch === '-') { i++; return -primary(); }
    if (ch === '+') { i++; return primary(); }
    if (ch === '~') { i++; return ~primary(); }
    if (ch === '<') { i++; return primary() & 0xFF; }
    if (ch === '>') { i++; return (primary() >> 8) & 0xFF; }
    if (ch === '*') { i++; return pc; }
    if (ch === "'" || ch === '"') { const end = src.indexOf(ch, i + 1); if (end !== i + 2) fail("character constants must be one character, like 'A'"); const v = src.charCodeAt(i + 1); i = end + 1; return v; }
    let m;
    const rest = src.slice(i);
    if ((m = rest.match(/^\$([0-9a-f]+)/i))) { i += m[0].length; return parseInt(m[1], 16); }
    if ((m = rest.match(/^0x([0-9a-f]+)/i))) { i += m[0].length; return parseInt(m[1], 16); }
    if ((m = rest.match(/^%([01]+)/))) { i += m[0].length; return parseInt(m[1], 2); }
    if ((m = rest.match(/^([0-9][0-9a-f]*)h\b/i))) { i += m[0].length; return parseInt(m[1], 16); }
    if ((m = rest.match(/^[0-9]+\b/))) { i += m[0].length; return parseInt(m[0], 10); }
    if ((m = rest.match(/^[A-Za-z_.@][A-Za-z0-9_.@]*/))) {
      i += m[0].length;
      const k = m[0].toUpperCase();
      if (syms.has(k)) return syms.get(k);
      if (strict) fail(`unknown label "${m[0]}"`);
      known = false; return 0;
    }
    fail(`can't read "${rest || expr}"`);
  }
  function mul() { let v = primary(); for (;;) { ws(); const c = src[i]; if (c === '*') { i++; v *= primary(); } else if (c === '/') { i++; const d = primary(); if (!d) { if (strict) fail('division by zero'); v = 0; } else v = Math.trunc(v / d); } else if (c === '%') { i++; const d = primary(); v = d ? v % d : 0; } else return v; } }
  function add() { let v = mul(); for (;;) { ws(); const c = src[i]; if (c === '+') { i++; v += mul(); } else if (c === '-') { i++; v -= mul(); } else return v; } }
  function shift() { let v = add(); for (;;) { ws(); if (src.startsWith('<<', i)) { i += 2; v <<= add(); } else if (src.startsWith('>>', i)) { i += 2; v >>= add(); } else return v; } }
  function band() { let v = shift(); for (;;) { ws(); if (src[i] === '&') { i++; v &= shift(); } else return v; } }
  function bxor() { let v = band(); for (;;) { ws(); if (src[i] === '^') { i++; v ^= band(); } else return v; } }
  function bor() { let v = bxor(); for (;;) { ws(); if (src[i] === '|' || src[i] === '!') { i++; v |= bxor(); } else return v; } }
  if (!src) fail('missing value');
  const v = bor(); ws();
  if (i < src.length) fail(`unexpected "${src.slice(i)}"`);
  return { v, known };
}

function parseString(s) {
  const t = s.trim();
  if (t.length >= 2 && t[0] === '"' && t[t.length - 1] === '"') return [...t.slice(1, -1)].map(c => c.charCodeAt(0) & 0xFF);
  if (t.length > 3 && t[0] === "'" && t[t.length - 1] === "'") return [...t.slice(1, -1)].map(c => c.charCodeAt(0) & 0xFF);
  return null;
}

// Work out the addressing-mode family from operand syntax.
function operandShape(mn, op) {
  const s = op.trim(), up = s.toUpperCase().replace(/\s+/g, '');
  if (!s) return { fam: 'none' };
  if (up === 'A' && ['ASL', 'LSR', 'ROL', 'ROR'].includes(mn)) return { fam: 'acc' };
  if (s[0] === '#') return { fam: 'imm', e: s.slice(1) };
  let m;
  if ((m = s.match(/^\(([\s\S]*),\s*[xX]\s*\)$/))) return { fam: 'izx', e: m[1] };
  if ((m = s.match(/^\(([\s\S]*)\)\s*,\s*[yY]$/))) return { fam: 'izy', e: m[1] };
  if (mn === 'JMP' && (m = s.match(/^\(([\s\S]*)\)$/))) return { fam: 'ind', e: m[1] };
  const parts = asmSplit(s, ',');
  if (parts.length === 2 && /^[xX]$/.test(parts[1])) return { fam: 'x', e: parts[0] };
  if (parts.length === 2 && /^[yY]$/.test(parts[1])) return { fam: 'y', e: parts[0] };
  if (parts.length > 1) throw new AsmError(`can't read operand "${s}"`);
  return { fam: 'addr', e: s };
}

// base: address used before the first ORG (default 0000h)
function assemble(source, base = 0) {
  const lines = source.split(/\r?\n/);
  const syms = new Map(), longForm = new Map(); // longForm: line -> true if absolute chosen in pass 1
  let result, pass1Errors = [];
  for (let pass = 1; pass <= 2; pass++) {
    const strict = pass === 2;
    const errors = [], chunks = [], listing = [];
    let pc = base & 0xFFFF, cur = null;
    const emit = (bytes, ln, text) => {
      if (!cur || cur.addr + cur.bytes.length !== pc) { cur = { addr: pc, bytes: [] }; chunks.push(cur); }
      listing.push({ addr: pc, bytes: bytes.slice(), line: ln, text });
      for (const b of bytes) { cur.bytes.push(b & 0xFF); pc = (pc + 1) & 0xFFFF; }
    };
    for (let ln = 0; ln < lines.length; ln++) {
      const original = lines[ln];
      try {
        let s = stripComment(original).replace(/\s+$/, '');
        if (!s.trim()) continue;
        const ev = (e, must) => asmEval(e, syms, pc, strict || must);
        let label = null, m;
        // "* = expr" sets the address
        if ((m = s.match(/^\s*\*\s*=\s*([\s\S]+)$/))) { pc = ev(m[1], true).v & 0xFFFF; cur = null; continue; }
        if ((m = s.match(/^\s*([A-Za-z_.@][A-Za-z0-9_.@]*)\s*:/))) { label = m[1]; s = s.slice(m[0].length); }
        else if ((m = s.match(/^([A-Za-z_.@][A-Za-z0-9_.@]*)\s*(=|\.?equ\b)/i))) { label = m[1]; s = s.slice(m[1].length); }
        else if ((m = s.match(/^([A-Za-z_.@][A-Za-z0-9_.@]*)(\s|$)/)) && !MNEMONICS.has(m[1].toUpperCase()) && !DIRECTIVES.has(m[1].toUpperCase().replace(/^\./, ''))) { label = m[1]; s = s.slice(m[1].length); }
        s = s.trim();
        let mn = '', rest = '';
        if ((m = s.match(/^(=|\.?[A-Za-z]+)\s*([\s\S]*)$/))) { mn = m[1].toUpperCase().replace(/^\./, ''); rest = m[2].trim(); }
        else if (s) throw new AsmError(`can't read "${s}"`);
        if (label) {
          const L = label.toUpperCase();
          if (L === 'A' || L === 'X' || L === 'Y') throw new AsmError(`"${label}" is a register name and can't be a label`);
          if (mn === 'EQU' || mn === '=') {
            const v = ev(rest).v;
            if (pass === 1 && syms.has(L) && syms.get(L) !== (v & 0xFFFF)) throw new AsmError(`"${label}" is defined twice`);
            syms.set(L, v & 0xFFFF);
            listing.push({ addr: null, bytes: [], line: ln, text: original.trim() });
            continue;
          }
          if (pass === 1 && syms.has(L)) throw new AsmError(`label "${label}" is defined twice`);
          syms.set(L, pc);
        }
        if (!mn) continue;
        switch (mn) {
          case 'ORG': pc = ev(rest, true).v & 0xFFFF; cur = null; continue;
          case 'END': ln = lines.length; continue;
          case 'BYTE': case 'DB': case 'DFB': case 'DCB': case 'TEXT': case 'ASCII': {
            const bytes = [];
            for (const item of asmSplit(rest, ',')) {
              const str = parseString(item);
              if (str) bytes.push(...str);
              else { const v = ev(item).v; if (strict && (v < -128 || v > 255)) throw new AsmError(`${item} doesn't fit in a byte`); bytes.push(v & 0xFF); }
            }
            emit(bytes, ln, original.trim()); continue;
          }
          case 'WORD': case 'DW': {
            const bytes = [];
            for (const item of asmSplit(rest, ',')) { const v = ev(item).v & 0xFFFF; bytes.push(v & 0xFF, v >> 8); }
            emit(bytes, ln, original.trim()); continue;
          }
          case 'DS': case 'RES': {
            const [n, fill] = asmSplit(rest, ',');
            const count = ev(n, true).v;
            if (count < 0 || count > 65536) throw new AsmError('DS size must be 0–65536');
            emit(new Array(count).fill(fill ? ev(fill).v & 0xFF : 0), ln, original.trim()); continue;
          }
        }
        if (!MNEMONICS.has(mn)) throw new AsmError(`not a 6502 instruction: ${mn}`);
        const sh = operandShape(mn, rest);
        const has = mode => ASM_OPS.has(mn + ' ' + mode);
        const isBranch = has('rel');
        let mode, val = 0;
        if (sh.fam === 'none') { mode = has('imp') ? 'imp' : has('acc') ? 'acc' : null; }
        else if (sh.fam === 'acc') mode = 'acc';
        else if (isBranch && sh.fam === 'addr') mode = 'rel';
        else if (['imm', 'izx', 'izy', 'ind'].includes(sh.fam)) mode = sh.fam;
        else {
          const r = ev(sh.e);
          val = r.v;
          const zpMode = sh.fam === 'x' ? 'zpx' : sh.fam === 'y' ? 'zpy' : 'zp';
          const absMode = sh.fam === 'x' ? 'abx' : sh.fam === 'y' ? 'aby' : 'abs';
          let useZp = has(zpMode) && r.known && val >= 0 && val <= 0xFF;
          if (pass === 1) longForm.set(ln, !useZp); else if (longForm.get(ln)) useZp = false;
          if (!has(absMode)) useZp = true;
          mode = useZp ? zpMode : absMode;
        }
        if (!mode || !has(mode)) throw new AsmError(`${mn} can't use this addressing mode${rest ? ': ' + rest : ''}`);
        const opc = ASM_OPS.get(mn + ' ' + mode), len = MODE_LEN[mode];
        const bytes = [opc];
        if (mode === 'rel') {
          const target = ev(rest).v;
          const off = target - ((pc + 2) & 0xFFFF);
          if (strict && (off < -128 || off > 127)) throw new AsmError(`branch target is ${off} bytes away; branches reach −128…127 (use JMP)`);
          bytes.push(off & 0xFF);
        } else if (len > 1) {
          if (sh.e !== undefined && !['zp', 'zpx', 'zpy', 'abs', 'abx', 'aby'].includes(mode)) val = ev(sh.e).v;
          if (len === 2) {
            if (strict && mode === 'imm' && (val < -128 || val > 255)) throw new AsmError(`#${sh.e.trim()} doesn't fit in a byte (use <value or >value for one byte of an address)`);
            if (strict && mode !== 'imm' && (val < 0 || val > 255)) throw new AsmError(`${sh.e.trim()} must be a zero-page address (00–FF) for this mode`);
            bytes.push(val & 0xFF);
          } else bytes.push(val & 0xFF, (val >> 8) & 0xFF);
        }
        emit(bytes, ln, original.trim());
      } catch (e) {
        if (!(e instanceof AsmError)) throw e;
        errors.push({ line: ln + 1, msg: e.message });
      }
    }
    if (pass === 1) { pass1Errors = errors.filter(e => /twice|register name/.test(e.msg)); continue; }
    const seen = new Set(pass1Errors.map(e => e.line));
    const all = pass1Errors.concat(errors.filter(e => !seen.has(e.line))).sort((x, y) => x.line - y.line);
    result = { chunks, errors: all, listing, syms };
  }
  return result;
}

if (typeof module !== 'undefined') module.exports = { assemble, ASM_OPS };
