# Scooter Lock

Local Bluetooth immobilizer for the scooter yellow wire.

- `fw/` is ESP-IDF firmware for the ESP32 dual-MOS board.
- `web/` is the Android Chrome control PWA.
- `docs/` contains wiring and BLE protocol notes.

The display USB 5 V supply powers the ESP. The same 5 V supply feeds the board
MOS input terminals. GPIO16 / OUT1 holds the SDD0-620N SSR input active after
Unlock, so its output connects yellow. Web Lock, ESP reset, or loss of display
USB power turns OUT1 off and opens yellow.

Bluetooth disconnect, page refresh, and phone sleep do not turn OUT1 off while
the ESP remains powered. The firmware does not deep-sleep while unlocked.

```text
display USB +5 V -> board USB-C and IN+
display USB GND  -> board IN-
board OUT1+      -> SSR input +
board OUT1-      -> SSR input -
SSR output       -> across the cut yellow wire
```

OUT2/GPIO17 and GPIO33 are unused in SSR mode. Red, orange, black, green, and
blue remain disconnected from the ESP board.

The app can save the passphrase in the browser on that phone. On refresh it
reconnects, authenticates, and reads the ESP’s SSR-control state again when
Chrome still has permission for the device. The run timer uses a saved
timestamp, so elapsed time catches up after backgrounding or refresh.
