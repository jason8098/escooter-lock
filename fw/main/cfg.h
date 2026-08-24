#pragma once

#include "driver/gpio.h"

/*
 * These are commissioning values, not verified facts about every board.
 * Keep the traction battery disconnected until HW.md has been completed.
 */
#define CFG_SET       GPIO_NUM_16
#define CFG_WAKE      GPIO_NUM_32
#define CFG_BTN       GPIO_NUM_0

#define CFG_ON        1
#define C_HOLD        3000
#define C_IDLE        90000
#define C_AUTH        20000
#define C_CLAIM       3000
#define C_RESET       8000

#define CFG_USER      "owner"
#define CFG_SALT      16
#define CFG_VER       384
#define C_REQMAX      448
#define C_RSPMAX      448
