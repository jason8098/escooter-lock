# Firmware acceptance checks

- At every boot/reset/brownout, both MOS outputs stay inactive; the lock module
  only reads GPIO33 and never corrects relay state automatically. The physical
  relay state is retained.
- Stable GPIO33 reports `locked` or `ready`; bouncing feedback reports
  `unknown`; a post-pulse mismatch reports `fault`.
- Repeating an `unlock` or completed `lock` request ID returns the cached reply
  and never adds a relay pulse. An older ID returns `repeat`.
- `arm` is rejected unless feedback is stable (`ready` or already `locked`) and
  the commissioned display-off gate is valid. A token cannot lock before
  3000 ms or after 10000 ms, cannot be reused, and is invalidated if the display
  becomes active. The already-locked path remains idempotent and never pulses.
- With `C_ORGOK=1`, GPIO25 must remain LOW for five seconds; HIGH, floating,
  unplugged detector, or detector-power loss blocks `arm`. With both orange and
  UART gates enabled, both must independently satisfy the OFF interval.
- Wrong SRP credentials trigger increasing reconnect delays; the fifth failure
  disconnects and starts a 60-second delay. A successful session clears it.
- A client that connects but never completes Security2 is disconnected after
  20 seconds and cannot hold the only BLE slot or prevent idle sleep forever.
- A claim credential can call only control `get` and binary `newpass`; relay
  commands and telemetry return `claim_only` until the owner verifier is set.
- `newpass` commits exactly 16 salt bytes plus a 384-byte SRP-3072 verifier,
  returns under the old session key, then applies the new verifier only after
  disconnect or the five-second restart deadline.
- After `newpass`, that old session can only repeat the cached success response;
  every new request returns `reconnect` until the session is replaced.
- Disconnect, phone sleep, browser refresh, advertising timeout, and ESP deep
  sleep never issue a lock/unlock command. GPIO32 is the only deep-sleep wake.
- Both UART taps remain input-only. Captured chunks are sequenced, overwrite
  drops are counted, malformed requests cannot overrun a 448-byte response, and
  unproven decoded fields stay `null`.
