#include "lock.h"

#include "cfg.h"
#include "driver/gpio.h"
#include "esp_check.h"
#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"
#include "freertos/task.h"

static SemaphoreHandle_t s_mux;
static lk_info_t s_info = {LK_UNKNOWN, "feedback_unknown"};

static int fb_read(void)
{
    int first = gpio_get_level(CFG_FB);
    for (int i = 0; i < 4; ++i) {
        vTaskDelay(pdMS_TO_TICKS(10));
        if (gpio_get_level(CFG_FB) != first) {
            return -1;
        }
    }
    return first;
}

static lk_state_t fb_state(void)
{
    int level = fb_read();
    if (level < 0) {
        return LK_UNKNOWN;
    }
    return level == CFG_FB_RDY ? LK_READY : LK_LOCKED;
}

static void coil(gpio_num_t pin)
{
    gpio_set_level(CFG_SET, !CFG_ON);
    gpio_set_level(CFG_RST, !CFG_ON);
    gpio_set_level(pin, CFG_ON);
    vTaskDelay(pdMS_TO_TICKS(C_PULSE));
    gpio_set_level(pin, !CFG_ON);
    vTaskDelay(pdMS_TO_TICKS(C_SETTLE));
}

static esp_err_t move(lk_state_t want, gpio_num_t pin, const char **gate)
{
    lk_state_t now = fb_state();
    s_info.state = now;
    s_info.fault = now == LK_UNKNOWN ? "feedback_unstable" : "";
    if (now == LK_UNKNOWN) {
        *gate = "not_ready";
        return ESP_ERR_INVALID_STATE;
    }
    if (now == want) {
        *gate = "already_set";
        return ESP_OK;
    }

    s_info.state = LK_UNKNOWN;
    s_info.fault = "moving";
    coil(pin);
    now = fb_state();
    if (now != want) {
        s_info.state = LK_FAULT;
        s_info.fault = "feedback_mismatch";
        *gate = "relay_fault";
        return ESP_ERR_INVALID_RESPONSE;
    }

    s_info.state = now;
    s_info.fault = "";
    *gate = "ok";
    return ESP_OK;
}

esp_err_t lk_init(void)
{
    /* Preload output latches before enabling output for either polarity. */
    gpio_set_level(CFG_SET, !CFG_ON);
    gpio_set_level(CFG_RST, !CFG_ON);
    gpio_config_t out = {
        .pin_bit_mask = (1ULL << CFG_SET) | (1ULL << CFG_RST),
        .mode = GPIO_MODE_OUTPUT,
        .pull_up_en = GPIO_PULLUP_DISABLE,
        .pull_down_en = GPIO_PULLDOWN_DISABLE,
        .intr_type = GPIO_INTR_DISABLE,
    };
    ESP_RETURN_ON_ERROR(gpio_config(&out), "lock", "output config");
    lk_idle();

    gpio_config_t in = {
        .pin_bit_mask = 1ULL << CFG_FB,
        .mode = GPIO_MODE_INPUT,
        .pull_up_en = GPIO_PULLUP_ENABLE,
        .pull_down_en = GPIO_PULLDOWN_DISABLE,
        .intr_type = GPIO_INTR_DISABLE,
    };
    ESP_RETURN_ON_ERROR(gpio_config(&in), "lock", "feedback config");

    s_mux = xSemaphoreCreateMutex();
    if (s_mux == NULL) {
        return ESP_ERR_NO_MEM;
    }

    /* Startup only observes the relay. It never energizes either coil. */
    s_info.state = fb_state();
    s_info.fault = s_info.state == LK_UNKNOWN ? "feedback_unstable" : "";
    return ESP_OK;
}

lk_info_t lk_get(void)
{
    if (s_mux != NULL && xSemaphoreTake(s_mux, pdMS_TO_TICKS(100)) == pdTRUE) {
        lk_state_t now = fb_state();
        if (s_info.state != LK_FAULT) {
            s_info.state = now;
            s_info.fault = now == LK_UNKNOWN ? "feedback_unstable" : "";
        }
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
    if (s_info.state == LK_FAULT) {
        *gate = "relay_fault";
        xSemaphoreGive(s_mux);
        return ESP_ERR_INVALID_STATE;
    }
    lk_state_t now = fb_state();
    if (now == LK_UNKNOWN) {
        s_info.state = LK_UNKNOWN;
        s_info.fault = "feedback_unstable";
        *gate = "not_ready";
        xSemaphoreGive(s_mux);
        return ESP_ERR_INVALID_STATE;
    }
    esp_err_t err = move(LK_READY, CFG_SET, gate);
    xSemaphoreGive(s_mux);
    return err;
}

esp_err_t lk_lock(bool off_ok, const char **gate)
{
    if (gate == NULL || s_mux == NULL) {
        return ESP_ERR_INVALID_STATE;
    }
    if (!off_ok) {
        *gate = "not_off";
        return ESP_ERR_INVALID_STATE;
    }
    if (xSemaphoreTake(s_mux, pdMS_TO_TICKS(1000)) != pdTRUE) {
        *gate = "busy";
        return ESP_ERR_TIMEOUT;
    }
    if (s_info.state == LK_FAULT) {
        *gate = "relay_fault";
        xSemaphoreGive(s_mux);
        return ESP_ERR_INVALID_STATE;
    }
    lk_state_t now = fb_state();
    if (now == LK_UNKNOWN) {
        s_info.state = LK_UNKNOWN;
        s_info.fault = "feedback_unstable";
        *gate = "not_ready";
        xSemaphoreGive(s_mux);
        return ESP_ERR_INVALID_STATE;
    }
    esp_err_t err = move(LK_LOCKED, CFG_RST, gate);
    xSemaphoreGive(s_mux);
    return err;
}

void lk_idle(void)
{
    gpio_set_level(CFG_SET, !CFG_ON);
    gpio_set_level(CFG_RST, !CFG_ON);
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
