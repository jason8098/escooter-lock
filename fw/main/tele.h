#pragma once

#include <stddef.h>
#include <stdint.h>
#include "esp_err.h"
#include "cfg.h"

#define TE_DATA 32

typedef enum {
    TD_UNKNOWN = 0,
    TD_ACTIVE,
    TD_OFF,
} td_state_t;

typedef struct {
    uint32_t seq;
    uint32_t ms;
    uint8_t ch;
    uint8_t len;
    uint8_t data[TE_DATA];
} te_raw_t;

typedef struct {
    uint32_t seq;
    uint32_t top;
    uint32_t drop;
    uint32_t ms;
    size_t count;
    te_raw_t raw[C_RAWMAX];
} te_snap_t;

esp_err_t te_init(void);
td_state_t te_disp(void);
const char *te_name(td_state_t state);
esp_err_t te_snap(uint32_t after, te_snap_t *snap);
