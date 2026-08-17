idf_component_register(
    SRCS "app.c" "ble.c" "cred.c" "js.c" "lock.c" "pwr.c" "tele.c"
    INCLUDE_DIRS "."
    REQUIRES bt esp_common esp_driver_gpio esp_driver_uart esp_event
             esp_hw_support esp_system esp_timer freertos mbedtls nvs_flash
             protocomm
)
