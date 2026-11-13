# LOCAL ONLY

A protocol reverse-engineering puzzle game. The cloud behind your smart home shuts down at midnight; learn how your
devices talk on the wire, then talk to them yourself.

Live: https://phennova.github.io/daily-builds/builds/2026-11-13-local-only/

## The idea
Friday 13 November 2026, 19:00. AirLux, the (fictional) company behind your air purifier, front-door lock and
thermostat, turns its cloud off at 23:59. You have a logic sniffer clipped onto the devices' wires and an app that
works until midnight. Every button you press in the app puts a frame on the wire.

You never get told the frame format. You build a **dissector**: an ordered list of fields (MAGIC, LEN, SEQ, CMD, DATA,
CHECK), each with a width, byte order, the fields it counts or covers, and a checksum algorithm. It is tested live
against every captured frame: bytes are coloured by field, and each frame gets verdicts (LEN ok? checksum ok?
counter increasing?). "LEN 16/16, CHK 3/16" is a hypothesis test, like a real reverse engineer diffing captures.

The same dissector is your packet forger. The Forge fills in magic, length, sequence and checksum using *your*
definitions; you choose the command and data. If your dissector is wrong, your frames are wrong and the device
rejects them.

## Five levels (plus midnight)
1. **The test pads** - purifier UART: framing, a length byte, an additive checksum. Unlock the TURBO speed the app hides.
   Has a step-by-step walkthrough.
2. **Sleep timer** - new firmware: two magic bytes, a whole-frame length, little-endian minutes, XOR/LRC checksums.
3. **Premium unlock** - the deadbolt's "Unlock" needs a subscription. A replayed frame from yesterday's log is
   rejected (sequence counter). Forge a fresh one; CRC-16 and big-endian values.
4. **Holiday mode** - the thermostat's Bluetooth bytes look like noise: repeating-XOR scrambling keyed by its MAC
   address (on the sticker). Descramble, then set frost protection below the app's limit. The device is silent on
   errors, so prove your dissector before you transmit.
5. **Re-provision** - the factory-reset purifier waits for a set-up frame of TLV records. Point its CA and
   certificate URLs at your own server, fix every length byte and the CRC, and it survives midnight.

Bytes, opcodes, magic values, checksum algorithms and keys are reshuffled per run ("New run" in Levels), so
you can't memorise the answers. Stars per level: 0-1 rejected frames = 3, 2-4 = 2, more = 1.

## How to play
- **Device** (phone tab 1): press buttons in the AirLux app to capture frames. Goals, notebook lessons and hints live here.
- **Wire** (tab 2): the sniffer. Tap a frame to inspect it; tick "diff vs selected" to highlight the bytes that
  differ. Build the dissector with the + buttons; tap a field chip to edit it (width, byte order, what LEN counts,
  checksum algorithm and coverage). "DATA -> forge" and "raw -> forge" copy a frame into the forge.
- **Forge** (tab 3): pick a command and type DATA as hex (`04`), text (`"hello"`), or numbers (`le16:90`,
  `be16:300`, `u8:7`). Raw hex mode sends exactly what you type (for replay experiments). The device console shows
  replies.
- On a wide screen all three panels are side by side. Sound on/off top right. Progress is saved in your browser.

## Tests
- `node tests/proto.test.js` - 2773 checks: CRC catalogue check values ("123456789": CRC-8 F4, CRC-8/MAXIM A1,
  CRC-16/MODBUS 4B37, CCITT-FALSE 29B1, XMODEM 31C3); for every level and 60 seeds the true dissector validates every
  capture, and any plausible alternative (other checksum, coverage, length range, byte order) that also validates
  every capture forges identical frames (no ambiguous puzzles); scripted solutions complete every goal, replays are
  rejected, scrambling round-trips.
- `index.html?selftest` - solves all five levels in the page and opens every overlay.
- Playtested by driving the real UI in headless Edge (button clicks, editor selects, forge inputs) through all five
  levels and midnight at 1440x900 and 375x812, no console errors, no horizontal overflow on a 375px phone.
- `index.html?demo` - the screenshot state.

## Honest limits
AirLux, its devices and protocols are fictional and simplified (one frame per press, no timing, no real crypto).
Audio is generated with WebAudio and runs without errors in headless Edge, but has not been checked by ear on phones.
Not tested on iOS Safari; touch layout checked by DOM metrics in a phone-sized emulated viewport.

## Credits / sources
- Scott J. Goldman, "Reverse Engineering My Coway Air Purifier to Ditch the Cloud" (scottjg.com, Nov 2026): the
  real-world trick behind level 5 (a device that fetches its root CA from a URL given during BLE provisioning).
- Greg Cook's CRC catalogue (reveng) for algorithm parameters and check values.
- H. von Foerster, P. M. Mora, L. W. Amiot, "Doomsday: Friday, 13 November, A.D. 2026", Science 132 (1960) - the date.

No dependencies, no network requests. MIT.
