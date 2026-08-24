#include "lock.h"

#include "cfg.h"
#include "driver/gpio.h"
#include "esp_check.h"
#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"

static SemaphoreHandle_t s_mux;
static lk_info_t s_info = {LK_LOCKED, ""};

static void ssr_set(bool on)
{
    gpio_set_level(CFG_SET, on ? CFG_ON : !CFG_ON);
}

static esp_err_t set_ssr(lk_state_t state, const char **gate)
{
    if (s_info.state == state) {
        *gate = "already_set";
        return ESP_OK;
    }
    ssr_set(state == LK_READY);
    s_info.state = state;
    s_info.fault = "";
    *gate = "ok";
    return ESP_OK;
}

esp_err_t lk_init(void)
{
    /* The bootloader has already driven GPIO16 inactive. Keep it inactive. */
    gpio_set_level(CFG_SET, !CFG_ON);
    gpio_config_t out = {
        .pin_bit_mask = 1ULL << CFG_SET,
        .mode = GPIO_MODE_OUTPUT,
        .pull_up_en = GPIO_PULLUP_DISABLE,
        .pull_down_en = GPIO_PULLDOWN_DISABLE,
        .intr_type = GPIO_INTR_DISABLE,
    };
    ESP_RETURN_ON_ERROR(gpio_config(&out), "lock", "output config");
    lk_idle();

    s_mux = xSemaphoreCreateMutex();
    if (s_mux == NULL) {
        return ESP_ERR_NO_MEM;
    }

    s_info.state = LK_LOCKED;
    s_info.fault = "";
    return ESP_OK;
}

lk_info_t lk_get(void)
{
    if (s_mux != NULL && xSemaphoreTake(s_mux, pdMS_TO_TICKS(100)) == pdTRUE) {
        lk_info_t copy = s_info;
        xSemaphoreGive(s_mux);
        return copy;
    }
    return (lk_info_t){LK_UNKNOWN, "busy"};
}

esp_err_t lk_ready(const char **gate)
{
    if (gate == NULL || s_mux == NULL) {
        return ESP_ERR_INVALID_STATE;
    }
    if (xSemaphoreTake(s_mux, pdMS_TO_TICKS(1000)) != pdTRUE) {
        *gate = "busy";
        return ESP_ERR_TIMEOUT;
    }
    esp_err_t err = set_ssr(LK_READY, gate);
    xSemaphoreGive(s_mux);
    return err;
}

esp_err_t lk_lock(const char **gate)
{
    if (gate == NULL || s_mux == NULL) {
        return ESP_ERR_INVALID_STATE;
    }
    if (xSemaphoreTake(s_mux, pdMS_TO_TICKS(1000)) != pdTRUE) {
        *gate = "busy";
        return ESP_ERR_TIMEOUT;
    }
    esp_err_t err = set_ssr(LK_LOCKED, gate);
    xSemaphoreGive(s_mux);
    return err;
}

void lk_idle(void)
{
    ssr_set(false);
}

const char *lk_name(lk_state_t state)
{
    switch (state) {
    case LK_LOCKED: return "locked";
    case LK_READY: return "ready";
    case LK_FAULT: return "fault";
    default: return "unknown";
    }
}
