#include "ble.h"
#include "cred.h"
#include "esp_err.h"
#include "esp_event.h"
#include "esp_log.h"
#include "esp_timer.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "lock.h"
#include "pwr.h"
#include "tele.h"

void app_main(void)
{
    /* Make both relay coil outputs inactive before any recoverable service. */
    ESP_ERROR_CHECK(lk_init());
    ESP_ERROR_CHECK(cr_init());

    esp_err_t err = esp_event_loop_create_default();
    if (err != ESP_OK && err != ESP_ERR_INVALID_STATE) {
        ESP_ERROR_CHECK(err);
    }
    ESP_ERROR_CHECK(pw_init());
    ESP_ERROR_CHECK(bl_init());

    err = te_init();
    if (err != ESP_OK) {
        ESP_LOGE("app", "Telemetry capture disabled: %s", esp_err_to_name(err));
    }

    bool started = false;
    int64_t retry = 0;
    if (!cr_ok()) {
        ESP_LOGW("app", "Unclaimed: hold internal GPIO0 for 3 seconds after boot");
    }

    for (;;) {
        bl_tick();
        if (cr_tick()) {
            if (started) {
                bl_mark(true);
            }
            pw_touch();
        }
        if (started && bl_due()) {
            bl_stop();
            started = false;
            retry = 0;
        }
        if (!started && cr_ok() && esp_timer_get_time() >= retry) {
            err = bl_start();
            if (err == ESP_OK) {
                started = true;
            } else {
                ESP_LOGE("app", "BLE start failed: %s", esp_err_to_name(err));
                retry = esp_timer_get_time() + 5000000LL;
            }
        }
        vTaskDelay(pdMS_TO_TICKS(100));
    }
}
