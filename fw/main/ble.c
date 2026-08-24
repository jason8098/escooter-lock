#include "ble.h"

#include <stdbool.h>
#include <inttypes.h>
#include <stdio.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include "cfg.h"
#include "cred.h"
#include "esp_check.h"
#include "esp_event.h"
#include "esp_log.h"
#include "esp_mac.h"
#include "esp_random.h"
#include "esp_timer.h"
#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"
#include "host/ble_gap.h"
#include "host/ble_hs.h"
#include "js.h"
#include "lock.h"
#include "mbedtls/base64.h"
#include "nimble/ble.h"
#include "protocomm.h"
#include "protocomm_ble.h"
#include "protocomm_security.h"
#include "protocomm_security2.h"
#include "pwr.h"

#define BL_NONE 0xffffu
#define NP_LEN  406
#define NP_OP   5

typedef struct {
    bool valid;
    uint32_t sid;
    uint32_t id;
    char rsp[C_RSPMAX + 1];
} bl_cache_t;

typedef struct {
    bool valid;
    uint32_t sid;
    int64_t start;
    char key[25];
} bl_arm_t;

static const char *TAG = "ble";
static protocomm_t *s_pc;
static protocomm_security2_params_t s_sec;
static uint8_t s_salt[CFG_SALT];
static uint8_t s_ver[CFG_VER];
static SemaphoreHandle_t s_mux;
static bl_cache_t s_cache;
static bl_arm_t s_arm;
static uint16_t s_conn = BL_NONE;
static bool s_auth;
static int64_t s_authdue;
static unsigned s_fail;
static int64_t s_ban;
static bool s_reload;
static int64_t s_due;
static char s_vinfo[180];

static protocomm_ble_name_uuid_t s_eps[] = {
    {"ver",  0xff50},
    {"sec",  0xff51},
    {"ctrl", 0xff52},
};

/* Canonical service UUID: 021a9004-0382-4aea-bff4-6b3f1c5adfb4. */
static const uint8_t s_uuid[16] = {
    0xb4, 0xdf, 0x5a, 0x1c, 0x3f, 0x6b, 0xf4, 0xbf,
    0xea, 0x4a, 0x82, 0x03, 0x04, 0x90, 0x1a, 0x02,
};

static esp_err_t out_copy(const char *rsp, uint8_t **out, ssize_t *out_n)
{
    size_t n = strlen(rsp);
    if (out == NULL || out_n == NULL || n > C_RSPMAX) {
        return ESP_ERR_INVALID_SIZE;
    }
    *out = malloc(n);
    if (*out == NULL) {
        return ESP_ERR_NO_MEM;
    }
    memcpy(*out, rsp, n);
    *out_n = n;
    return ESP_OK;
}

static void status(char *rsp, size_t rsp_n, uint32_t id, bool ok,
                   const char *gate, const char *extra)
{
    lk_info_t info = lk_get();
    const char *fault = info.fault == NULL ? "" : info.fault;
    int n = snprintf(rsp, rsp_n,
                     "{\"v\":1,\"id\":%" PRIu32 ",\"ok\":%s,"
                     "\"state\":\"%s\","
                     "\"gate\":\"%s\",\"fault\":\"%s\"%s}",
                     id, ok ? "true" : "false", lk_name(info.state),
                     gate, fault, extra == NULL ? "" : extra);
    if (n < 0 || (size_t)n >= rsp_n) {
        snprintf(rsp, rsp_n,
                 "{\"v\":1,\"id\":%" PRIu32 ",\"ok\":false,"
                 "\"state\":\"unknown\","
                 "\"gate\":\"internal\",\"fault\":\"response_size\"}", id);
    }
}

static bool key_eq(const char *a, const char *b)
{
    size_t an = strlen(a);
    size_t bn = strlen(b);
    unsigned diff = (unsigned)(an ^ bn);
    size_t n = an > bn ? an : bn;
    for (size_t i = 0; i < n; ++i) {
        unsigned ac = i < an ? (unsigned char)a[i] : 0;
        unsigned bc = i < bn ? (unsigned char)b[i] : 0;
        diff |= ac ^ bc;
    }
    return diff == 0;
}

static esp_err_t arm_make(uint32_t sid, char *extra, size_t extra_n)
{
    uint8_t raw[18];
    size_t key_n = 0;
    esp_fill_random(raw, sizeof(raw));
    if (mbedtls_base64_encode((uint8_t *)s_arm.key, sizeof(s_arm.key), &key_n,
                              raw, sizeof(raw)) != 0 || key_n != 24) {
        memset(raw, 0, sizeof(raw));
        return ESP_FAIL;
    }
    s_arm.key[key_n] = '\0';
    s_arm.sid = sid;
    s_arm.start = esp_timer_get_time();
    s_arm.valid = true;
    snprintf(extra, extra_n, ",\"key\":\"%s\",\"wait\":%d,\"ttl\":10000",
             s_arm.key, C_HOLD);
    memset(raw, 0, sizeof(raw));
    return ESP_OK;
}

static void cache_set(uint32_t sid, uint32_t id, const char *rsp)
{
    s_cache.valid = true;
    s_cache.sid = sid;
    s_cache.id = id;
    strlcpy(s_cache.rsp, rsp, sizeof(s_cache.rsp));
}

static bool np_req(const uint8_t *buf, ssize_t len, uint32_t *id)
{
    if (buf == NULL || len != NP_LEN || buf[0] != 1 || buf[1] != NP_OP) {
        return false;
    }
    *id = ((uint32_t)buf[2] << 24) | ((uint32_t)buf[3] << 16) |
          ((uint32_t)buf[4] << 8) | buf[5];
    return *id != 0;
}

static esp_err_t ctrl_cb(uint32_t sid, const uint8_t *in, ssize_t in_n,
                         uint8_t **out, ssize_t *out_n, void *priv)
{
    (void)priv;
    char rsp[C_RSPMAX + 1];
    char req[C_REQMAX + 1];
    char op[12] = {0};
    uint32_t id = 0;
    uint32_t ver = 0;
    bool is_np = np_req(in, in_n, &id);

    if (!is_np) {
        if (in == NULL || in_n <= 0 || in_n > C_REQMAX ||
            memchr(in, '\0', in_n) != NULL) {
            status(rsp, sizeof(rsp), 0, false, "bad_req", NULL);
            return out_copy(rsp, out, out_n);
        }
        memcpy(req, in, in_n);
        req[in_n] = '\0';
        if (js_u32(req, "v", &ver) != ESP_OK || ver != 1) {
            status(rsp, sizeof(rsp), 0, false, "bad_ver", NULL);
            return out_copy(rsp, out, out_n);
        }
        if (js_u32(req, "id", &id) != ESP_OK || id == 0) {
            status(rsp, sizeof(rsp), 0, false, "bad_id", NULL);
            return out_copy(rsp, out, out_n);
        }
        if (js_str(req, "op", op, sizeof(op)) != ESP_OK) {
            status(rsp, sizeof(rsp), id, false, "bad_req", NULL);
            return out_copy(rsp, out, out_n);
        }
    }

    if (xSemaphoreTake(s_mux, pdMS_TO_TICKS(1000)) != pdTRUE) {
        status(rsp, sizeof(rsp), id, false, "internal", NULL);
        return out_copy(rsp, out, out_n);
    }
    if (s_cache.valid && s_cache.sid == sid) {
        if (id == s_cache.id) {
            esp_err_t err = out_copy(s_cache.rsp, out, out_n);
            xSemaphoreGive(s_mux);
            return err;
        }
        if (id < s_cache.id) {
            status(rsp, sizeof(rsp), id, false, "repeat", NULL);
            xSemaphoreGive(s_mux);
            return out_copy(rsp, out, out_n);
        }
    } else {
        memset(&s_cache, 0, sizeof(s_cache));
        s_cache.sid = sid;
        s_arm.valid = false;
    }

    if (__atomic_load_n(&s_reload, __ATOMIC_ACQUIRE)) {
        status(rsp, sizeof(rsp), id, false, "reconnect", NULL);
        esp_err_t err = out_copy(rsp, out, out_n);
        xSemaphoreGive(s_mux);
        return err;
    }

    const char *gate = "ok";
    bool ok = true;
    char extra[96] = {0};
    if (!cr_owned() && !is_np && strcmp(op, "get") != 0) {
        ok = false;
        gate = "claim_only";
    } else if (is_np) {
        esp_err_t err = cr_set(&in[6], CFG_SALT, &in[22], CFG_VER);
        if (err != ESP_OK) {
            ok = false;
            gate = "internal";
        } else {
            bl_mark(false);
        }
    } else if (strcmp(op, "get") == 0) {
        /* Status is produced below. */
    } else if (strcmp(op, "unlock") == 0) {
        if (lk_ready(&gate) != ESP_OK) {
            ok = false;
            gate = lk_get().state == LK_FAULT ? "fault" : "not_ready";
        } else {
            gate = "ok";
        }
    } else if (strcmp(op, "arm") == 0) {
        lk_info_t info = lk_get();
        if (info.state != LK_READY && info.state != LK_LOCKED) {
            ok = false;
            gate = info.state == LK_FAULT ? "fault" : "not_ready";
        } else if (arm_make(sid, extra, sizeof(extra)) != ESP_OK) {
            ok = false;
            gate = "internal";
        }
    } else if (strcmp(op, "lock") == 0) {
        char key[32];
        int64_t now = esp_timer_get_time();
        if (js_str(req, "key", key, sizeof(key)) != ESP_OK || !s_arm.valid ||
            s_arm.sid != sid || !key_eq(key, s_arm.key)) {
            ok = false;
            gate = "bad_req";
        } else if (now - s_arm.start < (int64_t)C_HOLD * 1000) {
            ok = false;
            gate = "wait";
        } else if (now - s_arm.start > 10000000LL) {
            s_arm.valid = false;
            ok = false;
            gate = "expired";
        } else {
            s_arm.valid = false;
            if (lk_lock(&gate) != ESP_OK) {
                ok = false;
                gate = lk_get().state == LK_FAULT ? "fault" : "not_ready";
            } else {
                gate = "ok";
            }
        }
    } else {
        ok = false;
        gate = "bad_req";
    }

    status(rsp, sizeof(rsp), id, ok, gate, extra);
    cache_set(sid, id, rsp);
    pw_touch();
    esp_err_t err = out_copy(rsp, out, out_n);
    xSemaphoreGive(s_mux);
    return err;
}

void bl_kick(void)
{
    uint16_t conn = __atomic_load_n(&s_conn, __ATOMIC_RELAXED);
    if (conn != BL_NONE) {
        ble_gap_terminate(conn, BLE_ERR_REM_USER_CONN_TERM);
    }
}

static void bl_evt(void *arg, esp_event_base_t base, int32_t id, void *data)
{
    (void)arg;
    if (base == PROTOCOMM_TRANSPORT_BLE_EVENT) {
        protocomm_ble_event_t *evt = data;
        if (id == PROTOCOMM_TRANSPORT_BLE_CONNECTED && evt != NULL &&
            evt->conn_status == 0) {
            __atomic_store_n(&s_conn, evt->conn_handle, __ATOMIC_RELAXED);
            if (esp_timer_get_time() < s_ban) {
                bl_kick();
            } else {
                __atomic_store_n(&s_auth, false, __ATOMIC_RELAXED);
                __atomic_store_n(&s_authdue,
                                 esp_timer_get_time() +
                                     (int64_t)C_AUTH * 1000,
                                 __ATOMIC_RELAXED);
                pw_conn(true);
            }
        } else if (id == PROTOCOMM_TRANSPORT_BLE_DISCONNECTED) {
            __atomic_store_n(&s_conn, BL_NONE, __ATOMIC_RELAXED);
            __atomic_store_n(&s_auth, false, __ATOMIC_RELAXED);
            pw_conn(false);
            if (s_mux != NULL && xSemaphoreTake(s_mux, pdMS_TO_TICKS(100)) == pdTRUE) {
                memset(&s_cache, 0, sizeof(s_cache));
                memset(&s_arm, 0, sizeof(s_arm));
                xSemaphoreGive(s_mux);
            }
        }
        return;
    }
    if (base == PROTOCOMM_SECURITY_SESSION_EVENT) {
        if (id == PROTOCOMM_SECURITY_SESSION_SETUP_OK) {
            s_fail = 0;
            s_ban = 0;
            __atomic_store_n(&s_auth, true, __ATOMIC_RELEASE);
            pw_touch();
        } else if (id == PROTOCOMM_SECURITY_SESSION_INVALID_SECURITY_PARAMS ||
                   id == PROTOCOMM_SECURITY_SESSION_CREDENTIALS_MISMATCH) {
            if (s_fail < 31) {
                ++s_fail;
            }
            unsigned shift = s_fail > 5 ? 5 : s_fail - 1;
            unsigned delay = s_fail >= 5 ? 60 : 1u << shift;
            s_ban = esp_timer_get_time() + (int64_t)delay * 1000000;
            ESP_LOGW(TAG, "Authentication failed; retry delay %u seconds", delay);
            bl_kick();
        }
    }
}

esp_err_t bl_init(void)
{
    s_mux = xSemaphoreCreateMutex();
    if (s_mux == NULL) {
        return ESP_ERR_NO_MEM;
    }
    ESP_RETURN_ON_ERROR(esp_event_handler_register(PROTOCOMM_TRANSPORT_BLE_EVENT,
                                                   ESP_EVENT_ANY_ID, bl_evt, NULL),
                        TAG, "BLE event register");
    ESP_RETURN_ON_ERROR(esp_event_handler_register(PROTOCOMM_SECURITY_SESSION_EVENT,
                                                   ESP_EVENT_ANY_ID, bl_evt, NULL),
                        TAG, "security event register");
    return ESP_OK;
}

esp_err_t bl_start(void)
{
    if (s_pc != NULL || !cr_ok()) {
        return ESP_ERR_INVALID_STATE;
    }
    if (xSemaphoreTake(s_mux, pdMS_TO_TICKS(1000)) != pdTRUE) {
        return ESP_ERR_TIMEOUT;
    }
    memset(&s_cache, 0, sizeof(s_cache));
    memset(&s_arm, 0, sizeof(s_arm));
    xSemaphoreGive(s_mux);
    const uint8_t *salt;
    const uint8_t *ver;
    size_t salt_n, ver_n;
    ESP_RETURN_ON_ERROR(cr_get(&salt, &salt_n, &ver, &ver_n), TAG, "credential read");
    memcpy(s_salt, salt, salt_n);
    memcpy(s_ver, ver, ver_n);
    s_sec = (protocomm_security2_params_t){
        .salt = (const char *)s_salt,
        .salt_len = salt_n,
        .verifier = (const char *)s_ver,
        .verifier_len = ver_n,
    };

    uint8_t mac[6];
    ESP_RETURN_ON_ERROR(esp_read_mac(mac, ESP_MAC_BT), TAG, "MAC read");
    char name[20];
    snprintf(name, sizeof(name), "SCOOT-%02X%02X%02X", mac[3], mac[4], mac[5]);
    snprintf(s_vinfo, sizeof(s_vinfo),
             "{\"app\":{\"ver\":\"1.0.0\",\"proto\":1,\"sec\":2,"
             "\"sec_patch_ver\":1,\"mode\":\"%s\","
             "\"cap\":[\"ctrl\",\"sleep\"],"
             "\"id\":\"%02X%02X%02X\"}}",
             cr_owned() ? "owned" : "claim", mac[3], mac[4], mac[5]);

    protocomm_ble_config_t cfg = {0};
    strlcpy(cfg.device_name, name, sizeof(cfg.device_name));
    memcpy(cfg.service_uuid, s_uuid, sizeof(s_uuid));
    cfg.nu_lookup_count = sizeof(s_eps) / sizeof(s_eps[0]);
    cfg.nu_lookup = s_eps;
    /* Credential reload needs a complete NimBLE/GATT teardown. */
    cfg.keep_ble_on = 0;
    cfg.ble_notify = 0;

    s_pc = protocomm_new();
    if (s_pc == NULL) {
        return ESP_ERR_NO_MEM;
    }
    esp_err_t err = protocomm_ble_start(s_pc, &cfg);
    if (err == ESP_OK) {
        err = protocomm_set_version(s_pc, "ver", s_vinfo);
    }
    if (err == ESP_OK) {
        err = protocomm_set_security(s_pc, "sec", &protocomm_security2, &s_sec);
    }
    if (err == ESP_OK) {
        err = protocomm_add_endpoint(s_pc, "ctrl", ctrl_cb, NULL);
    }
    if (err != ESP_OK) {
        bl_stop();
        return err;
    }
    __atomic_store_n(&s_reload, false, __ATOMIC_RELAXED);
    pw_conn(false);
    ESP_LOGI(TAG, "Advertising as %s", name);
    return ESP_OK;
}

void bl_stop(void)
{
    if (s_pc == NULL) {
        return;
    }
    protocomm_remove_endpoint(s_pc, "ctrl");
    protocomm_unset_security(s_pc, "sec");
    protocomm_unset_version(s_pc, "ver");
    protocomm_ble_stop(s_pc);
    protocomm_delete(s_pc);
    s_pc = NULL;
    memset(s_salt, 0, sizeof(s_salt));
    memset(s_ver, 0, sizeof(s_ver));
    memset(&s_sec, 0, sizeof(s_sec));
    __atomic_store_n(&s_conn, BL_NONE, __ATOMIC_RELAXED);
    __atomic_store_n(&s_auth, false, __ATOMIC_RELAXED);
    pw_conn(false);
}

void bl_mark(bool kick)
{
    __atomic_store_n(&s_due, esp_timer_get_time() + 5000000LL,
                     __ATOMIC_RELAXED);
    __atomic_store_n(&s_reload, true, __ATOMIC_RELEASE);
    if (kick) {
        bl_kick();
    }
}

bool bl_due(void)
{
    return __atomic_load_n(&s_reload, __ATOMIC_ACQUIRE) &&
           (__atomic_load_n(&s_conn, __ATOMIC_RELAXED) == BL_NONE ||
            esp_timer_get_time() >= __atomic_load_n(&s_due, __ATOMIC_RELAXED));
}

void bl_tick(void)
{
    if (__atomic_load_n(&s_conn, __ATOMIC_RELAXED) != BL_NONE &&
        !__atomic_load_n(&s_auth, __ATOMIC_ACQUIRE) &&
        esp_timer_get_time() >=
            __atomic_load_n(&s_authdue, __ATOMIC_RELAXED)) {
        __atomic_store_n(&s_authdue, INT64_MAX, __ATOMIC_RELAXED);
        ESP_LOGW(TAG, "Unauthenticated connection timed out");
        bl_kick();
    }
}
