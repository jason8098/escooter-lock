# BLE Protocol

## UUID map

The service uses the Espressif provisioning UUID base so Protocomm can replace
its embedded 16-bit value for each endpoint.

| Endpoint | UUID |
| --- | --- |
| Service | `021a9004-0382-4aea-bff4-6b3f1c5adfb4` |
| `ver` | `021aff50-0382-4aea-bff4-6b3f1c5adfb4` |
| `sec` | `021aff51-0382-4aea-bff4-6b3f1c5adfb4` |
| `ctrl` | `021aff52-0382-4aea-bff4-6b3f1c5adfb4` |
| `tele` | `021aff53-0382-4aea-bff4-6b3f1c5adfb4` |

Protocomm requests use a characteristic write followed by a read. The web app
queues every transaction so two GATT operations never overlap.

## Version

`ver` is the only plaintext endpoint. It exposes protocol compatibility, not
relay state or credentials.

```json
{
  "app": {
    "ver": "1.0.0",
    "proto": 1,
    "sec": 2,
    "sec_patch_ver": 1,
    "mode": "owned",
    "cap": ["ctrl", "tele", "sleep"],
    "id": "A1B2C3"
  }
}
```

`mode` is `claim` until an owner verifier replaces the one-time claim verifier.
Security patch 1 means the AES-GCM IV is the eight-byte session ID followed by
a four-byte big-endian counter.

## Secure session

`sec` carries the exact ESP-IDF Security 2 `SessionData` protobuf exchange:

1. Client sends SRP-6a username and public key.
2. Device returns its public key and salt.
3. Client sends its proof.
4. Device returns its proof and 12-byte nonce.
5. Both sides use the first 32 bytes of the SRP SHA-512 session key for
   AES-256-GCM. Each encrypted request and response consumes the next IV
   counter.

The fixed username is `owner` for both initial claim and normal use. During
initial claim, that username is paired with the unique one-time secret printed
over USB. The `mode` field tells the browser whether it is claiming or using an
owned device. The browser discards all session material on disconnect, refresh,
or authentication failure.

## Control

After Security 2 is established, `ctrl` accepts UTF-8 JSON inside the encrypted
Protocomm payload. `v` is always `1`; `id` is a nonzero client request ID.

```json
{"v":1,"id":1,"op":"get"}
{"v":1,"id":2,"op":"unlock"}
{"v":1,"id":3,"op":"arm"}
{"v":1,"id":4,"op":"lock","key":"base64-token"}
```

`arm` succeeds only while the display-off gate is valid. It returns a random,
single-use token. `lock` accepts that token only after 3000 ms and before
10000 ms, while the off gate remains valid. The browser also cancels the hold
when the pointer is released, the page is hidden, or the connection changes.

A normal response has this shape:

```json
{
  "v": 1,
  "id": 4,
  "ok": true,
  "state": "locked",
  "disp": "off",
  "gate": "ok",
  "fault": ""
}
```

An `arm` response additionally contains `key`, `wait`, and `ttl`. Stable error
codes are `bad_req`, `bad_ver`, `bad_id`, `not_off`, `not_ready`, `wait`,
`expired`, `fault`, `repeat`, `claim_only`, `reconnect`, and `internal`.
`claim_only` means the one-time setup credential cannot operate the relay;
`reconnect` means a password change was committed and a fresh session is
required. Human-readable wording belongs in the web app, not on the wire.

`disp` is `off` only after every commissioned safety source agrees for five
continuous seconds. Sources can be the protected display-side orange-off
detector and verified UART inactivity. If neither source is commissioned, a
source has never produced valid evidence, or the detector is high/floating,
`disp` is `unknown` or `active` and `arm` is rejected.

The device caches the most recent completed request ID and serialized response.
A duplicate returns that response and never pulses a relay again. An older ID
is rejected.

`newpass` is the one binary control request because base64 JSON would exceed
the Protocomm BLE characteristic limit. It is exactly 406 bytes:

| Offset | Size | Value |
| --- | ---: | --- |
| 0 | 1 | protocol version, `1` |
| 1 | 1 | operation code, `5` |
| 2 | 4 | nonzero request ID, big-endian |
| 6 | 16 | browser-generated SRP salt |
| 22 | 384 | SRP-3072 verifier |

It never contains the new plaintext passphrase. The firmware persists the new
salt and verifier, encrypts a success response with the current session, and
keeps that session valid until the browser has read the response and
disconnects. The new verifier is used for the next connection.

While `mode` is `claim`, firmware permits only `get` and `newpass`. Relay
commands and telemetry are rejected even if a modified browser sends them.
After a successful `newpass`, only an exact duplicate request ID can retrieve
the cached success response; every new request under the old session returns
`reconnect` until the link closes or the service reaches its restart deadline.

## Telemetry

`tele` uses an encrypted poll request:

```json
{"v":1,"id":6,"op":"get","after":20,"max":2}
```

The response contains the newest delivered sequence, total dropped-chunk count,
verified decoded values, and only as many raw UART chunks as fit within the
transport limit. Framing remains unknown until a model-specific decoder exists.
Raw `dir` is `rx0` or `rx1`. Those labels deliberately avoid claiming a
physical direction until the blue/yellow harness signals are scoped.

```json
{
  "v": 1,
  "id": 6,
  "seq": 21,
  "drop": 0,
  "raw": [{"seq":21,"ms":12040,"dir":"rx0","data":"base64"}],
  "val": {
    "speed": null,
    "bat": null,
    "volt": null,
    "amp": null,
    "watt": null,
    "temp": null,
    "odo": null,
    "fault": null
  }
}
```

`null` means the field has not been proven for the connected controller. The
firmware caps the encrypted response below the Protocomm characteristic limit;
`drop` reports capture loss or ring overwrites, while unsent queued chunks can
be collected by the next `after` request.
