# Scooter lock firmware

This is an ESP-IDF 6.0.2 application for the classic ESP32 on the dual-MOS
board. It controls a two-coil latching relay, exposes secure BLE control, sleeps
after 90 seconds without a connection, and records two UART lines without ever
driving them.

The code is split into small safety boundaries:

- `lock.c` owns relay outputs and contact feedback. Startup only reads feedback.
- `cred.c` owns the SRP salt/verifier record in NVS and the physical claim flow.
- `ble.c` owns Protocomm Security2, command idempotency, lock timing, and limits.
- `tele.c` owns receive-only UART capture and the optional protected orange-off
  input. Both lock gates are disabled until their hardware is commissioned;
  all decoded values remain `null`.
- `pwr.c` owns connection-aware idle time and GPIO32 deep-sleep wake.

Read [HW.md](HW.md) before connecting the scooter. The shared wire contract is
in [../docs/proto.md](../docs/proto.md).

## Ownership

On a blank device, the control service does not start. After normal boot, hold
the internal GPIO0 button for three seconds. A 24-character one-time secret is
printed once over USB serial; only its SRP salt and verifier are committed.
Authenticate as username `owner`, then use `newpass` to replace the claim
verifier. Holding GPIO0 for eight seconds later replaces ownership with a new
one-time secret without moving the relay.

Claim sessions can read `get` status and set `newpass`; the device rejects
unlock, arm, lock, and telemetry with `claim_only` until ownership is complete.

## Release security

The default configuration is deliberately a prototype configuration. It does
not enable flash encryption, Secure Boot, or irreversible eFuse changes. Before
installing a final unit:

1. Validate flashing and recovery on a spare board.
2. Configure NVS encryption using the included `nvs_key` partition.
3. Configure flash encryption in Release mode and Secure Boot V2 with protected
   signing keys, following the ESP-IDF 6.0.2 security guide.
4. Verify encrypted NVS, signed-boot rejection, recovery, and power-loss cases
   before burning final eFuses.

Without those production settings the stored value is still an SRP verifier,
not a plaintext passphrase, but the NVS partition is not encrypted at rest.
