#pragma once

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
#include "esp_err.h"

esp_err_t cr_init(void);
bool cr_ok(void);
bool cr_owned(void);
esp_err_t cr_get(const uint8_t **salt, size_t *salt_n,
                 const uint8_t **ver, size_t *ver_n);
esp_err_t cr_set(const uint8_t *salt, size_t salt_n,
                 const uint8_t *ver, size_t ver_n);
bool cr_tick(void);
uint32_t cr_rev(void);
