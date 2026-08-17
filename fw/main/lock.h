#pragma once

#include <stdbool.h>
#include "esp_err.h"

typedef enum {
    LK_LOCKED = 0,
    LK_READY,
    LK_UNKNOWN,
    LK_FAULT,
} lk_state_t;

typedef struct {
    lk_state_t state;
    const char *fault;
} lk_info_t;

esp_err_t lk_init(void);
lk_info_t lk_get(void);
esp_err_t lk_ready(const char **gate);
esp_err_t lk_lock(bool off_ok, const char **gate);
void lk_idle(void);
const char *lk_name(lk_state_t state);
