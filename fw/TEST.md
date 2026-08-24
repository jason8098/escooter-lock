# SSR Acceptance

- At boot, reset, brownout, and display USB-power loss, GPIO16 is inactive and
  the SSR output is open.
- `unlock` makes GPIO16 active and keeps it active after the request completes.
- Bluetooth disconnect, phone sleep, and page refresh leave GPIO16 active while
  the ESP remains powered.
- The idle timer must not deep-sleep while GPIO16 is active.
- `lock` requires the three-second hold, then makes GPIO16 inactive and opens
  the SSR output.
- GPIO17 and GPIO33 are unused in SSR mode.
- With the scooter wheel raised, verify opening yellow has the intended effect
  before riding.
