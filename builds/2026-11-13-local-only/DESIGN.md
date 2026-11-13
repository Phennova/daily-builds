# LOCAL ONLY - design

Daily build, 2026-11-13 (Friday the 13th). Game (hardware hacking / protocol reverse-engineering puzzle).

## Concept
Friday 13 November 2026, 19:00. AirLux, the company behind every gadget in your flat, has announced that its
cloud shuts down at midnight. After that the app stops working and the devices "may become unresponsive". You
have five hours, a logic sniffer clipped onto the devices' wires, and the vendor app that still works until
midnight. Each press of an app button puts a frame on the wire. Your job is to work out the frame format from
the captures the way a real reverse engineer does it - diff frames, find the constant magic bytes, find the
byte that tracks the length, the opcode, the sequence counter, and prove which checksum covers which bytes -
and then speak the protocol yourself to do the things the app never let you do (or that now sit behind a
subscription). The finale, lifted from a real teardown, is re-provisioning the purifier so that it fetches its
root CA and certificates from YOUR server instead of the vendor's: at midnight the cloud dies, the neighbours'
devices brick, yours keeps running. LOCAL ONLY.

The central mechanic: you build a **dissector** (an ordered list of fields: MAGIC, LEN, SEQ, CMD, DATA, CHECK,
each with width/endianness/coverage/algorithm). It is applied live to every captured frame: bytes get coloured
by field, and each frame gets verdict badges (length field matches? checksum matches? magic constant? counter
increasing?). "LEN 14/14, CHK 0/14" is the hypothesis test. The same dissector then IS your packet forger: the
forge panel fills in magic, length, sequence and checksum automatically using your definitions, you only choose
CMD and DATA. If your dissector is wrong, your forged frames are wrong, and the device rejects them.

## Why would someone who has seen a hundred web games find this interesting?
It is a game about doing real protocol reverse engineering - diffing captures, testing a checksum hypothesis
against every frame, spotting little- vs big-endian from a timer value, beating replay protection, peeling a
repeating-XOR "encryption" with known plaintext - where the dissector you write is literally the tool you then
forge packets with, wrapped in a timely right-to-repair story (cloud shutdowns that brick hardware) and ending
on a real-world provisioning trick.

## Research / sources (checked 2026-11-13)
- Scott J. Goldman, "Reverse Engineering My Coway Air Purifier to Ditch the Cloud" (scottjg.com, 2026-11-11;
  #1 on Hacker News 2026-11-13): mitmproxy, the device downloads its root CA over plain HTTP, MQTT on 8883,
  BLE provisioning: "P001"/"P002" prefixed frames, AES key = 20 random letters + the MAC, and the provisioning
  payload carries caUrl/certSvrUrl - so you can point the device at your own server. Level 5 is a simplified,
  fictional echo of that (TLV instead of protobuf, no AES).
- Standard protocol-RE practice (ctfpal "Reversing a binary protocol from a capture"; reveng): find the
  constant, find the length field ("off-by-a-header"), group by opcode, counters, checksum tells, endianness from
  a known value, single-byte/repeating XOR before assuming real crypto.
- CRC catalogue check values ("123456789"): CRC-8 (poly 07) = F4, CRC-8/MAXIM = A1, CRC-16/MODBUS = 4B37,
  CRC-16/CCITT-FALSE = 29B1, CRC-16/XMODEM = 31C3. Unit-tested.
- Date flavour: von Foerster, Mora & Amiot, "Doomsday: Friday, 13 November, A.D. 2026", Science 132 (1960) -
  today is the day their hyperbola reached infinity; the cloud's "doomsday" is a nod in the intro text only.
- AirLux, its devices and protocols are FICTIONAL and simplified. Nothing here attacks real products.

## Candidates considered (novelty / wow / feasibility, 1-5)
1. local-only (this) - protocol RE puzzle game with dissector-as-forger. 4/4/4. Chosen: no game I could find
   does this (only tools: Netzob, usb-rea, browser CRC finders, serial playgrounds); new loop type for the repo
   (hypothesis-testing on structured data, not tuning a continuous parameter); security spacing ok (last
   security build 11-06); ties to today's #1 HN story; teaches Phennova's interest (cybersecurity) hands-on.
2. doomsday-desk - today IS von Foerster's doomsday: a "beat the prophets" forecasting game (doomsday 1960,
   Hubbert 1956, Moore 1965, Keeling CO2, Simon-Ehrlich wager) with the forecaster's own data, model choice,
   calibrated intervals scored by a proper scoring rule, then reality replays. 4/4/4 but the hook expires
   tonight and the loop is close to recent curve-fitting builds. Backlogged without the date hook.
3. packet-lab tool (field inference + CRC brute force in the browser). 3/3/4 - browser CRC finders and serial
   playgrounds already exist; the game version is more novel.
4. pattern-of-life - dystopian ALPR (Flock cameras, Guardian 2026-11-13): run errands through a camera grid
   while a live inference engine guesses your home, work and associates. 4/3/4. Backlogged.
5. stitch-out - embroidery digitising puzzle with fabric pull and thread-sheen render (Show HN zigzag,
   2026-11-12). 3/4/2. Backlogged.
6. blink-survey (backlog, now topical: new 280-year-orbit dwarf planet candidate, HN 2026-11-12). 4/4/4. Kept.

## Game structure
Clock advances per level (19:00, 20:00, ... 23:30, midnight epilogue). No real-time pressure.
Every level: the device on the bench (canvas art that reacts), the vendor app (buttons that make captures),
the sniffer (captured frames, both directions, labelled with what you pressed), the dissector, the forge, a
device console, the goals, and a notebook entry that teaches the concept in two short paragraphs.
Per-run randomisation (seeded): magic values, opcodes, checksum algorithm from a small pool per level, XOR key
(MAC), sensor values. So the levels can be replayed without memorising bytes.

### Level 1 - "The test pads" (purifier, UART between Wi-Fi module and MCU) - framing, length, sum checksum
  MAGIC(1) | LEN(1) = bytes of CMD..DATA | CMD(1) | DATA(n) | CHECK(1) = SUM8 of LEN..DATA
  App: power on/off, speed 1/2/3, light on/off. Device ACKs (CMD 0x80|cmd... same framing).
  Goal: TURBO (speed 4) - the motor supports it, the app never offers it.
  Device console is chatty: "ERR LEN", "ERR CHK", "ERR CMD", "ERR VAL" - training wheels.
### Level 2 - "Sleep timer" (purifier firmware v2) - whole-frame length, little-endian u16, XOR checksum
  MAGIC(2) | LEN(1) = whole frame incl. magic and check | CMD | DATA | CHECK = XOR8 of everything before it
  App: timer 1h/2h/4h/8h (u16 LE minutes: 3C 00, 78 00, F0 00, E0 01), speed, power.
  Goals: timer 90 min (5A 00) and 12 h (D0 02).
### Level 3 - "Premium unlock" (smart deadbolt, LAN) - sequence counter, replay rejection, CRC-16, big-endian
  MAGIC(2) | SEQ(1) | CMD | LEN(1) = DATA only | DATA | CRC16 (MODBUS, little-endian on the wire) of SEQ..DATA
  The app's Unlock is greyed out ("Premium"). A log has yesterday's unlock frame - replaying it gives
  "ERR SEQ". Auto-lock delays 30/60/120 s are u16 BIG-endian (00 1E, 00 3C, 00 78), unlike level 2.
  Goals: unlock with a fresh frame; auto-lock 300 s (01 2C).
### Level 4 - "Holiday mode" (thermostat, BLE) - repeating-XOR scrambling, known plaintext
  MAGIC(1) | then XOR-scrambled with a 4-byte key = last 4 bytes of the MAC (printed on the sticker):
  LEN(1) = CMD..DATA | CMD | DATA | CRC-8 of LEN..DATA (computed on plaintext, then scrambled)
  The dissector gets a "descramble XOR key" option; when the key is right, the noise snaps into structure.
  Setpoint is u16 BE tenths of a degree (21.5 C = 00 D7); app range 16-26 C.
  Device console is now silent on errors (realistic); bad frames are counted against your stars.
  Goal: frost protection 7.0 C (00 46) while you're away.
### Level 5 - "Re-provision" (purifier after factory reset, BLE provisioning) - TLV, strings, the real trick
  MAGIC "P2" (50 32) | LEN(2, BE) = DATA bytes | DATA = TLV records [type(1) len(1) value] |
  CRC-16/CCITT-FALSE (BE) of LEN..DATA
  Capture: the official provisioning frame: 01 ssid, 02 wifi password, 03 caUrl (http://ca.airlux-cloud.com/
  root.pem), 04 certSvrUrl (https://cert.airlux-cloud.com/r0), 05 token.
  Goal: send a provisioning frame whose caUrl/certSvrUrl point at your home server (http://10.0.0.2/...),
  keeping ssid/pwd/token. Lengths change -> TLV len, frame LEN and CRC all change.
### Epilogue - midnight
  Cloud lamp goes dark, the "neighbours" ticker shows bricked devices, your three keep working (fan spins,
  lock responds, thermostat holds 7.0 C). Summary: stars, bad frames sent, time. Restart / replay any level.

## Dissector model (exact)
Ordered fields; at most one DATA (variable). Parse: fields before DATA from the start, after DATA from the end;
without DATA the total fixed size must match. Field types:
- MAGIC(w=1..4): checks equal across frames (and vs the first frame).
- LEN(w=1|2, endian): value must equal byte count of fields [from..to] + adjust (adjust fixed 0; "from/to" are
  field references so "whole frame" = first..last).
- SEQ(1): must increase by 1 (mod 256) between consecutive frames of the same direction.
- CMD(1), DATA: no check; shown decoded.
- CHECK(w by algorithm, endian): algorithm in {SUM8, XOR8, LRC8 (two's complement of sum), CRC-8, CRC-8/MAXIM,
  CRC-16/MODBUS, CRC-16/CCITT-FALSE, CRC-16/XMODEM}; covers fields [from..to].
- Level >= 4: descramble XOR key (hex, repeating) applied to all bytes after the first MAGIC field.
Verdicts per frame and totals. Forge: auto-fills MAGIC (from captures), LEN, SEQ (last seen + 1), CHECK, and
re-scrambles; user edits CMD and DATA (hex, with u8/u16 LE/BE number and text-to-hex helpers). Raw hex mode too.
The device always parses with the TRUE protocol; goals are judged only by what the device does.

## Tech
Static folder: index.html, style.css, proto.js (protocols, CRCs, dissector engine, device models - pure, also
loadable in node), game.js (UI, levels, canvas device art), audio.js (WebAudio: fan hum, UART chirps, ACK/NAK,
lock clunk, midnight). No dependencies. Mobile-first DOM UI (hex tiles wrap), canvas for the device bench.
Mute button, prefers-reduced-motion. Progress in localStorage. `?demo` param for screenshot.

## Definition of done
- 5 levels + epilogue playable start to finish on desktop and a 390px-wide touch screen; title/intro, notebook
  lessons, stars, restart.
- Correct dissector validates 100% of captures in every level for every seed; plausible wrong dissectors fail
  on at least one capture (checked in tests); every goal achievable with the forge alone.
- No console errors; total size well under 1.5 MB; README, screenshot.

## Test plan
- node tests: CRC check values; per level x 50 seeds: true dissector validates all captures; each alternative
  checksum algorithm/coverage is rejected by at least one capture (captures disambiguate); scripted solution
  (forge with the true dissector) completes every goal; replayed frames rejected in L3; scrambled level decodes.
- Headless Edge: load, dump DOM, no JS errors; screenshots desktop + mobile; in-page self-test (?selftest).
