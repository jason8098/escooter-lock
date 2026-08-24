# MOS-safe test firmware

This separate ESP-IDF app keeps both suspected MOS output pins inactive:

- GPIO16 / OUT1: inactive
- GPIO17 / OUT2: inactive

Do not use this folder for the scooter SSR. Flash the real firmware from
`fw/` instead.

Flash from this folder:

```powershell
cd C:\Users\user\Documents\GitHub\escooter-lock\mosfw
idf.py set-target esp32
idf.py -p COM5 flash monitor
```

Replace `COM5` with the real serial port.
