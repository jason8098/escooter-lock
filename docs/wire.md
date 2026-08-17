# Wiring Gates

## Required parts

- Fused battery branch located close to its source.
- Low-quiescent protected converter: input rating at least 100 VDC, output
  12 VDC at 1 A or more.
- 12 V dual-coil DPDT latching relay.
- Relay contact rating at least 100 VDC, at least five times the measured
  steady e-lock current, and above the measured make/inrush current under its
  manufacturer's DC rating.
- Flyback diode across each relay coil.
- Sealed momentary wake button.
- High-impedance protected signal inputs or the correct isolated bus receiver.
- Waterproof enclosure, strain relief, vibration mounts, and DC-rated wiring.

The fuse value is selected after measuring steady and pulse current. Start
bench work from a current-limited 12 V supply and a small fused dummy load.
For the expected common-positive, low-side outputs, each external coil diode has
its cathode at coil +12 V and anode at its switched OUT- terminal. Verify the
actual board topology and any onboard suppression before fitting parts.

## Proposed low-voltage pins

| Use | ESP pin | Rule |
| --- | --- | --- |
| Relay SET coil | GPIO16 / OUT1 candidate | Verify on the actual PCB |
| Relay RESET coil | GPIO17 / OUT2 candidate | Verify on the actual PCB |
| Relay feedback | GPIO33 | Isolated dry contact only |
| Wake button | GPIO32 | Button to ground; debounced |
| Orange-off detector | GPIO25 candidate | Protected detector output only; disabled until verified |
| Display to controller | GPIO34 RX | Protected input only |
| Controller to display | GPIO35 RX | Protected input only |
| Setup/reset button | GPIO0 | Use only after normal boot |

GPIO34 and GPIO35 have no internal pulls. Fit external bias only after the bus
idle state is measured. Never expose any ESP pin to more than 3.6 V.

## Identified display harness

The control-display harness has now been identified as follows. Direction names
are relative to the display and still need an oscilloscope check before an ESP
input is connected.

| Color | Identified function | Immobilizer rule |
| --- | --- | --- |
| Red | battery positive feed | feed display and protected converter through a branch fuse |
| Orange | display-switched e-lock/key output | interrupt only this wire with the relay contact |
| Black | battery/display ground | converter return; signal reference only after measurement |
| Green | throttle | do not cut, tap, or connect to the ESP |
| Blue | display TX candidate | protected receive-only tap after voltage/framing checks |
| Yellow | display RX candidate | protected receive-only tap after voltage/framing checks |

The display has been observed to switch red-wire battery voltage onto orange
when it is turned on. Record the exact red/orange voltage at full charge and the
orange closed-circuit current before selecting or wiring the relay contacts.
Never connect orange directly to GPIO25. The proposed detector must be rated for
pack voltage and transients and present a low-voltage, power-off-tolerant output
that is LOW only while it positively confirms orange is off. Its pull-up must
make a broken detector, unplugged connector, or loss of detector power read as
active/not-off.

## Power path

```text
Display harness red (battery positive)
   |
 branch fuse
   |
 optional DC-rated master switch
   +--------------------------> display red
   |
100 V-rated protected converter
   |
  12 V -----------------------> ESP board VIN
   |                              |        |
   +---- SET relay coil ----------+ OUT1   |
   +---- RESET relay coil -----------------+ OUT2

Display orange (switched battery positive)
   |
DPDT latching relay pole A: open in LOCKED, closed in READY
   |
Controller orange e-lock/key input

Relay pole B (isolated low voltage) ------> GPIO33 state feedback
```

The converter and relay-coil wiring are separate from the orange-wire contact.
Do not route orange current through an ESP board terminal. Bench-identify which
contact is open in the firmware's `LOCKED` feedback state; latching relays do
not have a useful power-off default.

An optional master switch belongs only in this fused, low-current red harness
feed and must be rated for the measured DC voltage and current. It is not a
traction-battery disconnect. Because the latching relay retains `READY` with
red power removed, restore of the master switch also restores that unlocked
state. Lock first, or use a secured/keyed master switch as the independent
physical immobilizer.

## Controller identification gate

Record before wiring:

- Battery and charger labels and measured fully charged pack voltage.
- Controller maker, full model, voltage/current ratings, and wiring diagram.
- Display maker/model and every connector face.
- Confirmed connector orientation and the red/orange/black/green/blue/yellow
  order with photographs.
- Red and orange line voltage when the display is off and on, including at full
  battery charge.
- Current through the orange factory e-lock connection.
- Whether opening that circuit disables drive without switching battery current.

If no documented low-current enable circuit exists, leave the relay contact
disconnected. A traction-battery contactor and precharge stage are a separate
power-engineering design.

## Board verification gate

1. Keep the scooter disconnected.
2. Check continuity to determine whether output positives share VIN positive.
3. Power the board from a current-limited, fused 12 V source.
4. Use a small lamp or resistor as the channel load.
5. Exercise GPIO16 and GPIO17 separately and record channel and active level.
6. Confirm both outputs remain inactive through reset, startup, and brownout.
7. Measure relay-coil pulse current, output drop, leakage, and temperature.
8. Confirm each coil changes the relay state and both outputs return off.
9. With no pack connection to the ESP side, validate the orange detector across
   OFF, ON, disconnected, and detector-power-loss cases. Only confirmed OFF may
   produce a steady low output.

Do not commission the firmware until the measured mapping matches its board
configuration.

## Installation gate

- Use one DPDT pole for the verified ignition circuit and the other for relay
  feedback.
- Verify the relay's pole-to-pole insulation, creepage, and clearance rating;
  pack-level orange and GPIO feedback share a relay body but must remain safely
  isolated.
- Check that a firmware restart, BLE loss, and sleep leave the relay unchanged.
- Put the scooter on a stable stand with the driven wheel clear before the first
  controller test.
- Verify an authenticated relay close into already-energized orange cannot
  start the wheel with throttle applied; do not rely on wire color or assumed
  controller startup protection.
- Confirm display-on rejects Lock and display-off permits the deliberate lock
  sequence.
- Keep the antenna end of the ESP module outside metal shielding.
- Verify telemetry receivers cannot back-power the ESP through blue/yellow when
  the red master switch is open. Use power-off-tolerant protected buffers.
- Do not connect USB while 12 V VIN is present until the board's USB/VIN power
  path has been identified and proven safe.
- Seal the enclosure only after current, temperature, vibration, and standby
  drain measurements pass.

There is intentionally no physical override. If the ESP, converter, or relay
fails while locked, enclosure access is required.
