#include "pwr.h"

#include "cfg.h"
#include "esp_timer.h"
#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"

static SemaphoreHandle_t s_mux;
static bool s_conn;
static int64_t s_last;

esp_err_t pw_init(void)
{
    s_mux = xSemaphoreCreateMutex();
    if (s_mux == NULL) {
        return ESP_ERR_NO_MEM;
    }
    s_last = esp_timer_get_time();
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
