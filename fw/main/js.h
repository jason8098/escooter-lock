#pragma once

#include <stddef.h>
#include <stdint.h>
#include "esp_err.h"

esp_err_t js_str(const char *json, const char *key, char *out, size_t out_n);
esp_err_t js_u32(const char *json, const char *key, uint32_t *out);
