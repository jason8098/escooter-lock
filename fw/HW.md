# Hardware commissioning

## Non-negotiable limits

- Never route traction-battery or motor phase current through this board or the
  latching relay. Switch only a documented, measured low-current ignition,
  e-lock, key, or enable line.
- Do not feed the advertised 5-60 V input from a nominal 48 V scooter pack. A
  full pack and its transients can exceed the rating. Use a fused battery branch
  into a low-quiescent converter rated for at least 100 V input and 12 V/1 A
  output, with suitable transient protection.
- Use a dual-coil 12 V DPDT latching relay. Its contacts must be rated at least
  100 VDC, five times the measured steady ignition current, and above measured
  make/inrush current under a specified DC rating. Fit coil flyback protection
  appropriate for the board's common-positive, low-side switching. Verify
  pole-to-pole insulation because pack-level orange and GPIO feedback share the
  relay body.
- Provide a physical recovery path before sealing the enclosure. The requested
  design has no external mechanical override.

## Firmware pin map

| Signal | ESP32 pin | Default meaning |
| --- | ---: | --- |
| MOS OUT1 | GPIO16 | pulse relay SET / ignition ready |
| MOS OUT2 | GPIO17 | pulse relay RESET / locked |
| Wake button | GPIO32 | sealed button to GND |
| Relay feedback | GPIO33 | second relay pole to GND when ready |
| Orange-off input | GPIO25 candidate | protected fail-safe detector; disabled by default |
| UART capture 0 | GPIO34 | unknown receive-only channel `rx0` |
| UART capture 1 | GPIO35 | unknown receive-only channel `rx1` |
| Internal owner button | GPIO0 | physical claim/reset after normal boot |

GPIO33 uses an internal pull-up, so the default feedback polarity is low for
`ready` and high for `locked`. GPIO34/35 do not have usable internal pulls.

## Reported display harness

For this installation, the supplied harness identification is red battery
positive, orange display-switched e-lock/key, black ground, green throttle,
blue display TX, and yellow display RX. The display was reported to switch
red-wire battery voltage onto orange when turned on. These observations do not
establish functions for the same colors on another scooter.

- Split the fused red low-current feed to the display and the protected 100 V
  input converter.
- Cut only orange between display and controller, but only after the voltage
  and current checks below confirm it is the low-current enable line. Route it
  through the isolated relay pole that is open in `LOCKED` and closed in
  `READY`.
- Never route orange to an ESP pin. A proposed pack-rated detector feeds GPIO25
  LOW only when it positively confirms orange is off; HIGH/floating, unplugged,
  or detector power loss must block Lock.
- Leave green completely untouched.
- Treat blue/yellow directions and logic voltage as unverified until scoped;
  connect them only through a protected, power-off-tolerant receive front end
  that cannot back-power the ESP while the red master switch is open.
- Use black as converter return. Share it with a telemetry receiver only after
  confirming the measured signal reference is safe.

An optional master switch may interrupt the fused red display/converter branch,
but it must be rated for the measured pack-level DC voltage and branch current.
It is not a main traction-battery switch. The relay is latching: if red is cut
while state is `READY`, restoring red also restores that unlocked state. Lock
first, or make the master a secured/keyed independent cutoff.

Do not connect USB while 12 V VIN is present until the board's USB/VIN power
path has been identified and proven safe.

## Bench sequence

1. Photograph the connector faces and record the exact
   red/orange/black/green/blue/yellow order on both sides.
2. Measure maximum pack voltage plus orange's display-off voltage,
   display-on voltage, and closed current. Stop if orange is not a documented
   low-current e-lock line.
3. With a fused 12 V bench source and small dummy load, confirm which output is
   OUT1/OUT2, whether GPIO16/17 are correct, active-high behavior, and that both
   outputs are off at reset. Adjust only `cfg.h` if measurements disagree.
4. Wire the relay feedback pole and verify both stable states before allowing
   any relay command. Unstable/unknown feedback blocks both lock and unlock.
5. Prove reset, brownout, BLE loss, page refresh, and deep sleep never pulse a
   coil or change the latching relay.
6. Test the scooter with its driven wheel raised and the ignition branch fused,
   then use a controlled low-speed test area.

## Passive telemetry

Scope or logic-analyze the bus first. Confirm common ground, topology, idle and
peak voltage, polarity, baud, parity, stop bits, and direction. ESP32 inputs
must remain below 3.6 V; use high-impedance dividers/buffers for 5 V TTL and the
proper protected receiver for one-wire, CAN, or RS-485.

The firmware never configures a UART TX pin and never writes to either bus.
The API reports `rx0` and `rx1`; assign physical directions only after measuring
the installed harness.
`CFG_BAUD` is only a commissioning placeholder. `C_ORGOK` and `CFG_RAW_OK`
default to `0`, so locking is rejected. Set `C_ORGOK` to `1` only after the
detector's OFF, ON, unplugged, and power-loss behavior passes; set `CFG_RAW_OK`
to `1` only after wiring and baud reliably show display traffic. When both are
enabled, both must agree on OFF for five seconds. No field decoder is included
until the actual controller protocol is proven.
