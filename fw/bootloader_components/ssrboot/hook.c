#include "esp_rom_gpio.h"
#include "hal/gpio_ll.h"
#include "soc/gpio_struct.h"

#define SSR_PIN 16

/* Required so the bootloader linker keeps this hook object. */
void bootloader_hooks_include(void)
{
}

/*
 * Runs before ESP-IDF bootloader initialization and before app_main().
 * Set the output latch before enabling the pad so GPIO16 never drives high
 * from this point onward.
 */
void bootloader_before_init(void)
{
    gpio_ll_set_level(&GPIO, SSR_PIN, 0);
    esp_rom_gpio_pad_select_gpio(SSR_PIN);
    gpio_ll_set_level(&GPIO, SSR_PIN, 0);
    gpio_ll_output_enable(&GPIO, SSR_PIN);
}
