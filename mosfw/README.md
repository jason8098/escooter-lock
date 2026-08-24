# MOS output test firmware

This is a separate ESP-IDF test app. It sets both suspected MOS output pins high:

- GPIO16 / OUT1: HIGH
- GPIO17 / OUT2: HIGH

Use only with a fused dummy load, meter, lamp, or resistor. Do not connect this
test firmware to the scooter orange wire or to both latching-relay coils.

Flash from this folder:

```powershell
cd C:\Users\user\Documents\GitHub\escooter-lock\mosfw
idf.py set-target esp32
idf.py -p COM5 flash monitor
```

Replace `COM5` with the real serial port.
