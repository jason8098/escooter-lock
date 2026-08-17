# Telemetry Discovery

Telemetry remains electrically passive in the first release. No firmware path
enables UART transmission into the controller or display.

## Identify the bus

The current harness identification is blue = display TX candidate and yellow =
display RX candidate, with black as the candidate reference. These labels are
not permission to connect them directly: voltage, polarity, and direction must
still be confirmed on the installed harness. The green throttle wire is outside
telemetry scope and must remain untouched.

1. Photograph the controller/display labels, wiring diagram, connectors, wire
   order, and wire colors in the same frame.
2. With all power removed, identify ground and continuity through the harness.
3. With the driven wheel safely raised, use an oscilloscope or protected logic
   analyzer to record candidate signals. Do not attach an ESP yet.
4. Capture display startup, display shutdown, mode changes, brake state, a wheel
   turn, and a small throttle change.
5. Record idle, minimum, and maximum voltage, polarity, bit timing, and whether
   the signal is one-wire, separate TX/RX, differential, or another topology.
6. Save the raw capture plus controller/display model information together.

For the lock gate, first prove that valid blue/yellow activity is present while
the display/controller is operating and reliably stops when the display turns
off. Only then enable the five-second traffic-silence rule. Orange voltage is
pack-level e-lock signaling and must not be connected directly to a GPIO.

## Receiver selection

- Separate 3.3 V UART: tee through a high-impedance protected buffer to GPIO34
  and GPIO35.
- 5 V UART: use a proper level shifter or buffered divider; never connect it
  directly.
- One-wire UART: use one protected receive tap and leave transmit disconnected.
- CAN or RS-485: use the corresponding receiver/transceiver with suitable
  common-mode and transient ratings.
- Unknown or pack-referenced signaling: do not connect until an isolated front
  end is designed.

## Decoder rule

The firmware stores timestamped raw UART chunks in a bounded ring and reports
unread overwrites without delaying lock control. A model-specific framer and
decoder may expose
only fields proven by repeated captures and comparison with the factory
display. Unsupported values remain unavailable; they are never estimated.
