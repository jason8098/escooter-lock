#pragma once

#include <stdbool.h>
#include "esp_err.h"

esp_err_t pw_init(void);
void pw_conn(bool connected);
void pw_touch(void);
