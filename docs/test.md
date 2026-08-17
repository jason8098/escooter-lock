# Acceptance Checks

## Power and output

- Red/orange full-charge voltage and orange enabled current recorded.
- Orange make/inrush current and the red branch's display, converter cold-start,
  and relay-pulse peaks are recorded before fuse/switch/contact selection.
- Relay pole opens only the orange display-to-controller e-lock path; red and
  green never pass through an ESP output.
- Actual OUT1/OUT2 pin mapping and active level recorded.
- Both MOS outputs inactive after boot, reset, sleep, and brownout.
- Relay SET/RESET pulses meet its data sheet and end with both coils off.
- Relay feedback agrees with every commanded state; mismatch becomes `FAULT`.
- Converter remains stable across measured pack range and expected load pulses.
- Parked pack-side current is recorded before installation.
- Optional red-branch master switch has a suitable DC rating, and its retained
  `READY` behavior after power restore is understood and tested.
- Orange detector reports OFF only after five continuous seconds of a real OFF
  level; orange ON, detector unplugged, and detector power loss all block Lock.

## Control safety

- No BLE connection, disconnection, timeout, browser refresh, phone sleep, or
  ESP restart changes the relay.
- Unlock uses an authenticated explicit command and confirms contact feedback.
- With the wheel raised, unlocking while orange is already energized does not
  bypass the controller's high-throttle-at-start protection or cause wheel
  motion; stop integration if that protection is absent.
- Lock is rejected while display/controller activity is present.
- Lock succeeds only after the off gate and deliberate three-second hold.
- Repeated request IDs return the prior result without an extra relay pulse.
- Unknown feedback rejects state-changing commands.

## Authentication

- The advertised version endpoint contains no state or secret.
- Every control and telemetry operation rejects an unauthenticated session.
- Correct credentials create a fresh encrypted session.
- Wrong credentials apply delay and disconnect after five attempts.
- Captured, modified, stale, and cross-session messages are rejected.
- Password change invalidates the current session and accepts only the new one.
- Claim credentials can set the permanent passphrase but cannot operate the
  relay or read telemetry.
- Ownership reset preserves relay state and requires internal physical access.
- Release flash contains no plaintext owner password or bootstrap secret.

## Browser

- Android Chrome presents the device chooser only from a Connect tap.
- Reconnection reacquires every GATT service and characteristic.
- The UI reports `Unknown` until authenticated physical state is read.
- Parallel button presses cannot create parallel GATT operations.
- App assets reopen offline after one successful HTTPS load.
- Unsupported browsers receive a clear compatibility message.

## Telemetry

- Passive taps do not change factory-display operation or waveform quality.
- Noise, partial frames, and buffer overflow never block control.
- Dropped-frame count is visible.
- Every decoded field matches the factory display or an independent instrument.
