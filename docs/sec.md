# Production security

The checked-in defaults are intentionally recoverable prototype settings. They
use Security 2 over BLE and store only an SRP salt/verifier, but they do not turn
on flash encryption, NVS encryption, Secure Boot, or irreversible eFuse policy.

Before a final installation:

1. Complete relay, brownout, ownership-reset, and serial-recovery testing on a
   spare board.
2. Verify the actual ESP32 silicon revision. Secure Boot V2 on classic ESP32
   requires revision 3.0 or later; do not infer this only from the module label.
3. Back up the per-product RSA signing key outside the repository and document
   a signed recovery-image process.
4. Enable NVS encryption with the flash-encryption protection scheme. The
   included `nvs_key` partition is the required 4 KiB `nvs_keys` partition.
5. Enable flash encryption in Release mode with a unique device key, then
   enable Secure Boot V2 and the intended UART/JTAG policy.
6. Confirm the default NVS partition is encrypted, an unsigned or modified app
   is rejected, the signed recovery image works, and interrupted first boot
   does not strand the unit.
7. Only then provision the final device and permanently apply the selected
   eFuse settings.

Flash-encryption Release mode and Secure Boot eFuse changes are not reversible.
The repository does not enable them automatically, generate production keys,
or contain a private signing key.

Authoritative references:

- [ESP-IDF security overview](https://docs.espressif.com/projects/esp-idf/en/stable/esp32/security/security.html)
- [Security enablement workflows](https://docs.espressif.com/projects/esp-idf/en/stable/esp32/security/security-features-enablement-workflows.html)
- [NVS encryption](https://docs.espressif.com/projects/esp-idf/en/stable/esp32/api-reference/storage/nvs_encryption.html)
- [Secure Boot V2](https://docs.espressif.com/projects/esp-idf/en/stable/esp32/security/secure-boot-v2.html)
