# BLE Protocol

| Endpoint | UUID |
| --- | --- |
| Service | `021a9004-0382-4aea-bff4-6b3f1c5adfb4` |
| `ver` | `021aff50-0382-4aea-bff4-6b3f1c5adfb4` |
| `sec` | `021aff51-0382-4aea-bff4-6b3f1c5adfb4` |
| `ctrl` | `021aff52-0382-4aea-bff4-6b3f1c5adfb4` |

`ver` is plaintext compatibility data. `sec` uses Espressif Protocomm Security
2. `ctrl` carries encrypted requests. Every connection creates a new secure
session.

```json
{"v":1,"id":1,"op":"get"}
{"v":1,"id":2,"op":"unlock"}
{"v":1,"id":3,"op":"arm"}
{"v":1,"id":4,"op":"lock","key":"base64-token"}
```

`unlock` holds GPIO16 / OUT1 active, which keeps the SSR input and yellow-wire
connection active. `arm` creates a single-use lock token. `lock` accepts that
token after a three-second hold and before its ten-second expiry, then turns
GPIO16 / OUT1 off. There is no orange, display, speed, TX/RX, or relay-feedback
probe in this version; Lock is controlled only by the authenticated hold.

Example response:

```json
{"v":1,"id":4,"ok":true,"state":"locked","gate":"ok","fault":""}
```

The device caches the last completed request ID. Repeating it returns the same
response and never changes GPIO16 / OUT1 again. Bluetooth disconnect, browser
refresh, and timeout issue no relay command. The ESP does not deep-sleep while
the SSR output is active; reset or USB-power loss opens the SSR output.

`newpass` is an encrypted 406-byte `ctrl` request containing a browser-made
16-byte salt and 384-byte SRP verifier. It contains no plaintext passphrase.
During claim mode only `get` and `newpass` are permitted.
