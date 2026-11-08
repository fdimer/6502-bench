# 6502 Bench

An NMOS 6502 emulator for debugging programs and designing hardware around the chip. It runs in a web browser and shows the state of all 40 pins on every clock cycle. It is a sister project of [Z80 Bench](https://github.com/fdimer/z80-bench), with the same layout.

**Try it online:** <https://fdimer.github.io/6502-bench/app/>

Open `6502-bench.html` in any web browser, from this folder on your computer (it loads the CPU core and assembler from `src/`). It needs no installation or internet connection; the web fonts fall back to system fonts offline.

To get a single self-contained file instead, run `python build.py`, which writes `6502-bench-standalone.html`.

## Features

- **Pinout**: 40-pin DIP view that updates every clock cycle (high, low, or floating). Click the input pins to drive them:
  - φ0 pulses one clock, which is one bus cycle
  - /IRQ is level-sensitive and masked by the I flag (with the real one-instruction delay after CLI, SEI and PLP)
  - /NMI triggers on a falling edge
  - /SO sets the V flag on a falling edge
  - RDY low stops the CPU on its next read cycle; writes still complete, as on the NMOS part
  - /RES held low keeps the CPU in reset; releasing it runs the 7-cycle reset sequence and loads PC from FFFCh
- **Cycle-accurate bus**: every cycle is a real memory access, including the dummy reads and writes the 6502 makes during indexed addressing, page crossings, branches and read-modify-write instructions. The bus timing panel shows φ2, SYNC, R/W, address and data for each cycle of the current instruction.
- **Program input**: switch between Assembly and Hex.
  - Assembly: standard 6502 syntax. Labels start in column 1 or end with `:`. Supports `.org` / `* =`, `=` / `EQU`, `.byte`, `.word`, `.res`, `.end`, expressions, `*` for the current address, and `<label` / `>label` for the low and high byte. Zero page is chosen automatically when the address is known to be below 0100h.
  - Hex: bytes with optional `ADDR:` jumps, or Intel HEX.
  - **Import file…** (or drop a file on the editor): `.asm`/`.s`/`.a65` go to Assembly; `.hex`/`.ihx` and plain hex text go to Hex; raw `.bin`/`.rom` images are converted to hex.
  - **Load at** sets where code goes in memory, for example the start of ROM. In Assembly it applies until the first `.org`; Intel HEX keeps its own addresses.
  - After loading, the CPU is reset through the reset vector at FFFCh if the program sets one; otherwise PC is set to the load address.
- **Memory map**: RAM size from 0000h, a write-protected ROM region at the top of memory (8000h, C000h, E000h or F000h to FFFFh), and a 16-byte memory-mapped I/O block. Unmapped reads return FFh or the last value on the data bus. The defaults (16 KB RAM, I/O at 6000h, ROM from 8000h) follow a common hobby layout.
- **Stepping**: one cycle, one instruction, or run at 5 Hz, 50 Hz, 1 kHz, 5 kHz, 10 kHz or full speed.
- **Breakpoints**: click a line in the disassembly to cycle between *break at* (filled dot: stops before the instruction runs), *break after* (ring: stops once it has run, wherever it went next) and off.
- **Register stops**: click **stop** beside any register and give a hex value; the run halts at the end of the instruction that changes the register to that value, in every run mode.
- **Debug pane**: lists every breakpoint and stop, with a × to remove each and a click to jump to it. From it you can also add:
  - *memory stops*: halt after the instruction that changes the byte at an address, or changes it to a given value
  - *pin stops*: halt on the clock where a pin changes, goes high or goes low (while one is set, full speed runs clock by clock, so it is slower)
- **I/O**: writes to the I/O block are shown as 8-LED latches with a log of every access. You can set the value each register returns when read.

## Files

| Path | What it is |
|---|---|
| `6502-bench.html` | The application: layout, pin model, cycle engine and panels; loads the two files in `src/` |
| `src/m6502core.js` | CPU core: all 151 documented NMOS opcodes, cycle-by-cycle bus log, IRQ/NMI/reset sequences, NMOS decimal mode; disassembler |
| `src/m6502asm.js` | Two-pass assembler |
| `build.py` | Writes `6502-bench-standalone.html`, one file with everything inlined (`python build.py`) |
| `tests/functional-test.js` | Runs Klaus Dormann's 6502 functional test |
| `tests/singlestep-test.js` | Checks every documented opcode, cycle by cycle, against Tom Harte's SingleStepTests |
| `tests/asm-test.js` | Round-trips all 151 documented opcodes through the disassembler and assembler |

## Verification

- **Klaus Dormann's functional test** passes, decimal mode included: the success trap at 3469h is reached after 96,241,364 cycles, the published figure for this test.
- **SingleStepTests**: all 1,510,000 cases for the 151 documented opcodes match the real chip, including the address, data and read/write of every bus cycle and the NMOS decimal-mode flags.
- **Assembler**: all 151 documented opcodes assemble to the expected bytes.

## Running the tests

The tests need [Node.js](https://nodejs.org/). The test programs themselves are not included; get them from their own repositories:

```
node tests/asm-test.js
node tests/functional-test.js path/to/6502_functional_test.bin
node tests/singlestep-test.js path/to/65x02/6502/v1
```

- [Klaus2m5/6502_65C02_functional_tests](https://github.com/Klaus2m5/6502_65C02_functional_tests) (`bin_files/6502_functional_test.bin`)
- [SingleStepTests/65x02](https://github.com/SingleStepTests/65x02) (`6502/v1`)

## Known limitations

- Undocumented (illegal) opcodes are not emulated: the CPU stops ("jammed") and the disassembly shows `???`. Reset to recover.
- During clock stepping, registers and memory update together at the end of each instruction, not partway through it. Bus activity on the pins is exact for every cycle.
- RDY holds the read cycle in place, but the value read is the one present when the instruction started.
- Interrupts are taken at instruction boundaries. The rare hardware quirks (an NMI hijacking a BRK, the extra delay after a taken branch that doesn't cross a page) are not modelled.
- The 65C02 (CMOS) is not modelled yet.

## Licence

6502 Bench is licensed under the [PolyForm Noncommercial License 1.0.0](LICENSE.md). You may use, copy, modify and share it for any noncommercial purpose, including personal projects, education and research. Commercial use needs separate permission from the copyright holder. See [NOTICE](NOTICE).
