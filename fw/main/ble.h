#pragma once

#include <stdbool.h>
#include "esp_err.h"

esp_err_t bl_init(void);
esp_err_t bl_start(void);
void bl_stop(void);
void bl_kick(void);
void bl_mark(bool kick);
bool bl_due(void);
void bl_tick(void);
