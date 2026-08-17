# Scooter Lock

This repository contains a local-only Bluetooth immobilizer for an electric
scooter:

- `fw/` contains ESP-IDF firmware for the ESP32-32E dual-MOS board.
- `web/` contains the Android Chrome control PWA.
- `docs/` contains wiring, telemetry discovery, protocol, and acceptance notes.

The unit opens or closes only the controller's verified low-current
ignition/e-lock circuit through an isolated latching-relay contact. The two
onboard MOS channels pulse the relay coils; they never carry battery or motor
controller current.

## Fixed design choices

- Battery: nominal 48 V, reported charger limit 54.2 V.
- Board supply: separate fused, transient-protected 100 V-input to 12 V
  converter.
- Output: 12 V dual-coil DPDT latching relay with state feedback.
- Harness: the relay interrupts only the orange display-to-controller e-lock
  wire; red supplies the display and protected converter, black is return,
  blue/yellow are unverified receive-only telemetry candidates, and green
  throttle is untouched.
- Lock gate: optional protected orange-off confirmation on GPIO25 plus verified
  UART inactivity; every uncommissioned or enabled gate fails closed.
- Owner device: Android Chrome using Web Bluetooth.
- UI: static HTML, CSS, and JavaScript with Bootstrap 5.3.8.
- Authentication: ESP-IDF Protocomm Security 2; the owner passphrase is never
  stored or sent over BLE, while the bootstrap secret is printed once over USB.
- Parked behavior: push button wakes BLE; connection loss and resets never
  operate the relay.
- Telemetry: receive-only until the display/controller bus is identified.

## Safety gates

Do not connect this system to the scooter until all gates in
[`docs/wire.md`](docs/wire.md) pass. In particular:

1. Confirm the controller's actual ignition/e-lock pins, voltage, and current.
2. Confirm the board channel mapping at 12 V with a fused dummy load.
3. Confirm the relay contact has the required DC voltage rating.
4. Confirm controller/display signals are at a safe level before connecting an
   ESP GPIO.

This is an electronic drive immobilizer, not a physical theft lock. The chosen
display-off plus hold rule reduces accidental cut-off risk, but it cannot prove
zero speed without a wheel-speed sensor.

Final irreversible device-hardening steps are separated in
[`docs/sec.md`](docs/sec.md); the repository defaults remain recoverable for
prototype and ownership-reset testing.

## Web deployment

The Pages workflow publishes only `web/` whenever that folder changes on
`main`. In the GitHub repository settings, select **GitHub Actions** as the Pages
source. The resulting HTTPS site can install its local app shell for offline
use; Bluetooth device selection still requires an explicit tap in Android
Chrome.

## Current hardware gaps

The display wire functions are now identified, but connector orientation,
full-charge red/orange measurements, orange current, blue/yellow signal levels,
and the telemetry protocol still need recorded bench evidence. The pictured
board also has no trustworthy published schematic, MOS current limit, or
transient rating. Firmware therefore defaults to uncommissioned, leaves relay
outputs inactive at startup, and keeps decoded telemetry unavailable until
explicit configuration is added.
