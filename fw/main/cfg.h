#pragma once

#include "driver/gpio.h"

/*
 * These are commissioning values, not verified facts about every board.
 * Keep the traction battery disconnected until HW.md has been completed.
 */
#define CFG_SET       GPIO_NUM_16
#define CFG_RST       GPIO_NUM_17
#define CFG_WAKE      GPIO_NUM_32
#define CFG_FB        GPIO_NUM_33
#define CFG_RX0       GPIO_NUM_34
#define CFG_RX1       GPIO_NUM_35
#define CFG_ORG       GPIO_NUM_25
#define CFG_BTN       GPIO_NUM_0

#define CFG_ON        1
#define CFG_FB_RDY    0
#define C_PULSE       150
#define C_SETTLE      120
#define C_OFFMS       5000
#define C_HOLD        3000
#define C_IDLE        90000
#define C_AUTH        20000
#define C_CLAIM       3000
#define C_RESET       8000

#define CFG_BAUD      9600
#define CFG_RAW_OK    0
#define C_ORGOK       0

#define CFG_USER      "owner"
#define CFG_SALT      16
#define CFG_VER       384
#define C_REQMAX      448
#define C_RSPMAX      448
#define C_RAWMAX      2
