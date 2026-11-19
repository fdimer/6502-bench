# 6502 Bench: Apple II branch (Apple II Plus, RFI main board)

This branch turns 6502 Bench into an Apple II Plus with the RFI revision of the main board (820-0044): the 6502 with its pinout, bus timing, disassembly and debug points, wired to the Apple's memory, video and I/O. It was built from Jim Sather's *Understanding the Apple II* (1983), the *Apple II Reference Manual* (1979) and the main logic board schematic in Apple's addendum for the RFI board. It branches from the PET branch, whose files (`src/pet.js`, `src/m6821.js`, `src/m6522.js`, `tests/pet-test.js`) are still here but not used by the page.

- **Machine**: 16K, 32K or 48K of RAM in rows C, D and E; the six 2K ROMs D0-F8 (Applesoft BASIC and the Autostart Monitor); the I/O strobes at C000h-C0FFh. No peripheral cards: C080h-CFFFh float.
- **Timing**: 65 cycles a line, the first one long (16 periods of 14.31818 MHz instead of 14), 262 lines a frame, 17,030 cycles; 1,020,484 cycles a second on average.
- **Video**: generated cycle by cycle from the video scanner's own addresses (the 4-bit adder of H3-H5 with V3 and V4, Sather table 5.1), so a mode switch or a write to screen memory in the middle of a frame shows where it happens. TEXT through the text ROM (DL6 and DL7 on its A9 and A10, normal, inverse and flashing), LORES (each nibble circulated at 14M), HIRES (bit 7 delays the byte by one 14M period), MIXED, PAGE 1 and 2. The picture is 560 dots of 14M a line; on a colour monitor each dot takes the colour of the four around it (one cycle of the colour reference), and TEXT lines are white because the colour killer removes the burst.
- **The floating bus**: an address nothing answers reads the byte the scanner drove out of RAM in the same cycle; so do bits 0-6 of the serial inputs.
- **Keyboard**: the II Plus encoder's codes (upper case, SHIFT-N ^, SHIFT-M ], SHIFT-P @, CTRL), CTRL-RESET, REPT; from the PC keyboard or the on-screen keys. Text can be typed in from a box (BASIC programs, Monitor commands).
- **Game I/O**: two paddles on the 558 timers ((R + 100) x 0.022 microseconds), three push buttons, the four annunciators; the speaker (C030h), with sound; the cassette output toggle.
- **Memory chips, with faults**: the 24 4116s (the chip in column 3 of a row holds bit 0, column 10 bit 7; the 6502's address goes to RA0-RA6 as A7/A10, A2/A4, A0/A5, A8/A11, A3/A9, A1/A6, A12/A13), the six ROMs and the text ROM, with live pins; click a pin to hold its line or disconnect it. RAM faults show in the picture too, since the scanner reads the same chips.
- **Debugging**: memory bitmap tinted by the screen pages and Applesoft's use of memory, an Apple II hardware panel (soft switches, keyboard latch, speaker, paddles, the scanner's position, address and floating-bus byte), a log of the C000h-C0FFh accesses, and a text listing with the BASIC program.
- **Cassette**: the cassette input (C060h) plays a recording (any audio file the browser decodes), or a tape made from a binary file in the Monitor's format (a header of 650-cycle half cycles, a sync bit of 200 and 250, 0 bits of 2 x 250 and 1 bits of 2 x 500 cycles, the checksum); recording the output (C020h) gives a WAV file. Checked against the Monitor's W and R and Applesoft's SAVE and LOAD.
- **Language card** (slot 0): Apple's 16K RAM card: two 4K banks at D000h and 8K at E000h-FFFFh over the ROMs, switched at C080h-C08Fh, with the two-read write enable.
- **Disk II** (slot 6): the controller with two drives; .dsk and .do (DOS 3.3 order), .po (ProDOS order) and .nib images, write protect, writing, and saving the disk back as an image. The disk turns under the head at its real rate (a nibble every 32 cycles); the card's logic state sequencer is not simulated bit by bit, so software that counts bits or times the gaps between nibbles (copy protection) may not run. It boots with the card's boot PROM (P5, 341-0027), which is Apple's and not included: load your own with the ROM folder. A file of the chip as it is wired on the card (address lines A5 and A7 swapped, data bits 4-7 reversed) is recognised and rearranged. With the card fitted, the Autostart ROM boots drive 1 at power on, as on the real machine.
- **50 Hz**: the Eurapple jumpers: the vertical scanner presets to 011001000, 312 lines, 20,280 cycles a frame (50.32 Hz).
- **Not yet**: the logic state sequencer at the bit level (copy-protected disks), other cards (printer, serial, 80 columns).

**ROMs are not included.** Load your own with the Load ROM folder button: the six system ROMs (341-0011 to 341-0015 and 341-0020) and the text ROM (341-0036), as 2K files, or the system ROMs as one 12K file of D000h-FFFFh. They are recognised by their contents, as is the Disk II's boot PROM (256 bytes) if it is in the folder. Open `6502-bench.html` from this folder. The machine is `src/apple2.js`, the Disk II `src/a2disk.js`; `node tests/apple2-test.js` checks it with a small synthetic ROM, and with `A2_ROMS` set to a folder of the ROM images it also boots Applesoft and runs BASIC, and, if the boot PROM is there too, boots a test disk (.dsk and .po) through it; with a DOS 3.3 disk image in the folder (a name with "DOS" and "3.3", ending .dsk or .do) it boots DOS, catalogues the disk, saves and loads a program, and boots the saved image.

The rest of this file describes the 6502 Bench base.

---

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
- **Breakpoints**: click a line in the disassembly to cycle between *break at* (filled dot: stops before the instruction runs), *break after* (ring: stops when the PC leaves that address, so a branch to itself keeps running until it falls through) and off.
- **Register stops**: click **stop** beside any register and give a hex value; the run halts at the end of the instruction that changes the register to that value, in every run mode.
- **Debug pane**: lists every breakpoint and stop, with a × to remove each and a click to jump to it. From it you can also add:
  - *memory stops*: halt after the instruction that changes the byte at an address, or changes it to a given value
  - *pin stops*: halt on the clock where a pin changes, goes high or goes low (while one is set, full speed runs clock by clock, so it is slower)
  - *bus stops*: halt on the clock where the address bus or data bus takes a given value (like pin stops, these slow full speed while set)
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
