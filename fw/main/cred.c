#include "cred.h"

#include <inttypes.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "cfg.h"
#include "driver/gpio.h"
#include "esp_log.h"
#include "esp_random.h"
#include "esp_srp.h"
#include "esp_timer.h"
#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"
#include "nvs.h"
#include "nvs_flash.h"

#define CR_MAGIC 0x53434c31u

typedef struct {
    uint32_t magic;
    uint32_t rev;
    char user[8];
    uint16_t salt_n;
    uint16_t ver_n;
    uint8_t owned;
    uint8_t pad[3];
    uint8_t salt[CFG_SALT];
    uint8_t ver[CFG_VER];
} cr_rec_t;

static const char *TAG = "cred";
static cr_rec_t s_rec;
static nvs_handle_t s_nvs;
static SemaphoreHandle_t s_mux;
static int64_t s_down;
static bool s_fired;

static bool rec_ok(const cr_rec_t *rec)
{
    return rec->magic == CR_MAGIC && rec->salt_n == CFG_SALT &&
           rec->ver_n == CFG_VER && strcmp(rec->user, CFG_USER) == 0;
}

static esp_err_t rec_save(const cr_rec_t *rec)
{
    esp_err_t err = nvs_set_blob(s_nvs, "record", rec, sizeof(*rec));
    if (err == ESP_OK) {
        err = nvs_commit(s_nvs);
    }
    return err;
}

static esp_err_t cr_make(void)
{
    uint8_t rnd[12];
    char otp[sizeof(rnd) * 2 + 1];
    esp_fill_random(rnd, sizeof(rnd));
    for (size_t i = 0; i < sizeof(rnd); ++i) {
        snprintf(&otp[i * 2], 3, "%02X", rnd[i]);
    }

    char *salt = NULL;
    char *ver = NULL;
    int ver_n = 0;
    esp_err_t err = esp_srp_gen_salt_verifier(
        CFG_USER, strlen(CFG_USER), otp, strlen(otp), &salt, CFG_SALT,
        &ver, &ver_n);
    if (err != ESP_OK || salt == NULL || ver == NULL || ver_n <= 0 ||
        ver_n > CFG_VER) {
        free(salt);
        free(ver);
        memset(otp, 0, sizeof(otp));
        memset(rnd, 0, sizeof(rnd));
        return err == ESP_OK ? ESP_ERR_INVALID_SIZE : err;
    }

    cr_rec_t next = {
        .magic = CR_MAGIC,
        .rev = s_rec.rev + 1,
        .salt_n = CFG_SALT,
        .ver_n = CFG_VER,
    };
    strlcpy(next.user, CFG_USER, sizeof(next.user));
    memcpy(next.salt, salt, CFG_SALT);
    /* Big-endian MPI output may omit leading zeroes; store a fixed SRP-3072 width. */
    memcpy(next.ver + (CFG_VER - ver_n), ver, ver_n);

    err = rec_save(&next);
    if (err == ESP_OK) {
        s_rec = next;
        ESP_LOGW(TAG, "One-time owner secret: %s", otp);
        ESP_LOGW(TAG, "Save it now; it is not stored and is printed only once");
    }

    free(salt);
    free(ver);
    memset(otp, 0, sizeof(otp));
    memset(rnd, 0, sizeof(rnd));
    memset(&next, 0, sizeof(next));
    return err;
}

esp_err_t cr_init(void)
{
    esp_err_t err = nvs_flash_init();
    if (err != ESP_OK) {
        /* Never erase ownership automatically on an NVS error. */
        return err;
    }
    err = nvs_open("locksec", NVS_READWRITE, &s_nvs);
    if (err != ESP_OK) {
        return err;
    }

    s_mux = xSemaphoreCreateMutex();
    if (s_mux == NULL) {
        return ESP_ERR_NO_MEM;
    }

    size_t n = sizeof(s_rec);
    err = nvs_get_blob(s_nvs, "record", &s_rec, &n);
    if (err == ESP_ERR_NVS_NOT_FOUND) {
        memset(&s_rec, 0, sizeof(s_rec));
        err = ESP_OK;
    } else if (err != ESP_OK || n != sizeof(s_rec) || !rec_ok(&s_rec)) {
        memset(&s_rec, 0, sizeof(s_rec));
        return err == ESP_OK ? ESP_ERR_INVALID_CRC : err;
    }

    gpio_config_t btn = {
        .pin_bit_mask = 1ULL << CFG_BTN,
        .mode = GPIO_MODE_INPUT,
        .pull_up_en = GPIO_PULLUP_ENABLE,
        .pull_down_en = GPIO_PULLDOWN_DISABLE,
        .intr_type = GPIO_INTR_DISABLE,
    };
    return gpio_config(&btn);
}

bool cr_ok(void)
{
    return rec_ok(&s_rec);
}

bool cr_owned(void)
{
    return cr_ok() && s_rec.owned != 0;
}

esp_err_t cr_get(const uint8_t **salt, size_t *salt_n,
                 const uint8_t **ver, size_t *ver_n)
{
    if (salt == NULL || salt_n == NULL || ver == NULL || ver_n == NULL || !cr_ok()) {
        return ESP_ERR_INVALID_STATE;
    }
    *salt = s_rec.salt;
    *salt_n = s_rec.salt_n;
    *ver = s_rec.ver;
    *ver_n = s_rec.ver_n;
    return ESP_OK;
}

esp_err_t cr_set(const uint8_t *salt, size_t salt_n,
                 const uint8_t *ver, size_t ver_n)
{
    if (salt == NULL || ver == NULL || salt_n != CFG_SALT || ver_n != CFG_VER ||
        s_mux == NULL) {
        return ESP_ERR_INVALID_ARG;
    }
    if (xSemaphoreTake(s_mux, pdMS_TO_TICKS(1000)) != pdTRUE) {
        return ESP_ERR_TIMEOUT;
    }

    cr_rec_t next = {
        .magic = CR_MAGIC,
        .rev = s_rec.rev + 1,
        .salt_n = CFG_SALT,
        .ver_n = CFG_VER,
        .owned = 1,
    };
    strlcpy(next.user, CFG_USER, sizeof(next.user));
    memcpy(next.salt, salt, salt_n);
    memcpy(next.ver, ver, ver_n);
    esp_err_t err = rec_save(&next);
    if (err == ESP_OK) {
        s_rec = next;
    }
    memset(&next, 0, sizeof(next));
    xSemaphoreGive(s_mux);
    return err;
}

bool cr_tick(void)
{
    int64_t now = esp_timer_get_time();
    if (gpio_get_level(CFG_BTN) != 0) {
        s_down = 0;
        s_fired = false;
        return false;
    }
    if (s_down == 0) {
        s_down = now;
        return false;
    }
    if (s_fired) {
        return false;
    }

    int wait_ms = cr_ok() ? C_RESET : C_CLAIM;
    if ((now - s_down) / 1000 < wait_ms) {
        return false;
    }
    s_fired = true;
    if (xSemaphoreTake(s_mux, pdMS_TO_TICKS(1000)) != pdTRUE) {
        return false;
    }
    esp_err_t err = cr_make();
    xSemaphoreGive(s_mux);
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "Owner credential generation failed: %s", esp_err_to_name(err));
        return false;
    }
    ESP_LOGW(TAG, "Owner credential replaced; relay state was not changed");
    return true;
}

uint32_t cr_rev(void)
{
    return s_rec.rev;
}
