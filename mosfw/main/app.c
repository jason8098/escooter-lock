#include "driver/gpio.h"
#include "esp_log.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"

#define MOS1 GPIO_NUM_16
#define MOS2 GPIO_NUM_17
#define ON 1

void app_main(void)
{
    gpio_config_t cfg = {
        .pin_bit_mask = (1ULL << MOS1) | (1ULL << MOS2),
        .mode = GPIO_MODE_OUTPUT,
        .pull_up_en = GPIO_PULLUP_DISABLE,
        .pull_down_en = GPIO_PULLDOWN_DISABLE,
        .intr_type = GPIO_INTR_DISABLE,
    };

    ESP_ERROR_CHECK(gpio_config(&cfg));
    gpio_set_level(MOS1, ON);
    gpio_set_level(MOS2, ON);

    ESP_LOGW("mosfw", "GPIO16 and GPIO17 are HIGH");

    for (;;) {
        vTaskDelay(pdMS_TO_TICKS(1000));
    }
}
