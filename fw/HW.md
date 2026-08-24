# SSR Wiring

| Use | Pin | Connection |
| --- | --- | --- |
| SSR control | GPIO16 / OUT1 | SSR input negative through board MOS |
| Wake button | GPIO32 | Momentary button to ground |
| Claim/reset button | GPIO0 | Internal button only |

Use the display USB 5 V supply as one source for both the ESP USB-C power and
the board MOS supply terminals: USB +5 V to `IN+`, USB ground to `IN-`.

Connect board `OUT1+` to SSR input `+`, and board `OUT1-` to SSR input `-`.
Put the SSR output terminals across the two sides of the cut yellow wire.

GPIO17/OUT2 and GPIO33 are not connected. Do not connect ESP GPIO to scooter
red, orange, black, green, blue, or yellow wires.
