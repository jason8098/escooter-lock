# SDD0-620N Wiring

```text
display USB +5 V -> ESP USB-C power
                -> board IN+
display USB GND  -> board IN-

board OUT1+      -> SDD0-620N input +
board OUT1-      -> SDD0-620N input -

cut yellow side A -> SDD0-620N output terminal
cut yellow side B -> SDD0-620N other output terminal
```

Use one USB 5 V source only. Do not connect another supply to board `IN+`/`IN-`
while USB is present. GPIO16/OUT1 is held on after Unlock and held through BLE
disconnect. It turns off only after Web Lock, ESP reset, or USB-power loss.

Keep OUT2/GPIO17, GPIO33, and all other scooter wires disconnected from the
ESP board.
