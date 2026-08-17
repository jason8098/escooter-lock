#include "pwr.h"

#include "cfg.h"
#include "driver/gpio.h"
#include "driver/rtc_io.h"
#include "esp_log.h"
#include "esp_sleep.h"
#include "esp_timer.h"
#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"
#include "freertos/task.h"
#include "lock.h"

static SemaphoreHandle_t s_mux;
static bool s_conn;
static int64_t s_last;

static void sleep_now(void)
{
    if (gpio_get_level(CFG_WAKE) == 0) {
        pw_touch();
        return;
    }
    lk_idle();
    rtc_gpio_init(CFG_WAKE);
    rtc_gpio_set_direction(CFG_WAKE, RTC_GPIO_MODE_INPUT_ONLY);
    rtc_gpio_pullup_en(CFG_WAKE);
    rtc_gpio_pulldown_dis(CFG_WAKE);
    ESP_ERROR_CHECK(esp_sleep_enable_ext0_wakeup(CFG_WAKE, 0));
    ESP_LOGI("power", "Idle window ended; relay retained and wake button armed");
    esp_deep_sleep_start();
}

static void pw_task(void *arg)
{
    (void)arg;
    for (;;) {
        bool connected;
        int64_t last;
        if (xSemaphoreTake(s_mux, portMAX_DELAY) == pdTRUE) {
            connected = s_conn;
            last = s_last;
            xSemaphoreGive(s_mux);
        } else {
            connected = true;
            last = esp_timer_get_time();
        }
        if (!connected && esp_timer_get_time() - last >=
                              (int64_t)C_IDLE * 1000) {
            sleep_now();
        }
        vTaskDelay(pdMS_TO_TICKS(500));
    }
}

esp_err_t pw_init(void)
{
    rtc_gpio_deinit(CFG_WAKE);
    gpio_config_t wake = {
        .pin_bit_mask = 1ULL << CFG_WAKE,
        .mode = GPIO_MODE_INPUT,
        .pull_up_en = GPIO_PULLUP_ENABLE,
        .pull_down_en = GPIO_PULLDOWN_DISABLE,
        .intr_type = GPIO_INTR_DISABLE,
    };
    esp_err_t err = gpio_config(&wake);
    if (err != ESP_OK) {
        return err;
    }
    s_mux = xSemaphoreCreateMutex();
    if (s_mux == NULL) {
        return ESP_ERR_NO_MEM;
    }
    s_last = esp_timer_get_time();
    if (xTaskCreate(pw_task, "power", 2048, NULL, 3, NULL) != pdPASS) {
        return ESP_ERR_NO_MEM;
    }
    return ESP_OK;
}

void pw_conn(bool connected)
{
    if (s_mux != NULL && xSemaphoreTake(s_mux, pdMS_TO_TICKS(100)) == pdTRUE) {
        s_conn = connected;
        s_last = esp_timer_get_time();
        xSemaphoreGive(s_mux);
    }
}

void pw_touch(void)
{
    if (s_mux != NULL && xSemaphoreTake(s_mux, pdMS_TO_TICKS(100)) == pdTRUE) {
        s_last = esp_timer_get_time();
        xSemaphoreGive(s_mux);
    }
}
