# Scooter Lock Firmware

ESP-IDF firmware for the ESP32 dual-MOS board and SDD0-620N SSR.

- GPIO16 / OUT1 holds the SSR input on while unlocked.
- Web Lock turns GPIO16 off after the three-second hold.
- Bluetooth disconnect does not change GPIO16.
- The power manager stays awake while GPIO16 is on.
- Reset or loss of display USB power turns GPIO16 off and opens the SSR.

GPIO17 and GPIO33 are unused. There is no orange probe, relay feedback, UART,
TX/RX connection, or telemetry endpoint in SSR mode.

On a blank unit, hold internal GPIO0 for three seconds after normal boot. The
USB serial console prints a one-time secret. Authenticate as `owner`, then set
a 10–64 character passphrase in the web Setup page. The device stores only SRP
salt/verifier data, not the plaintext passphrase.
