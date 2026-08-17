#include "js.h"

#include <ctype.h>
#include <stdbool.h>
#include <string.h>

static const char *ws(const char *p)
{
    while (*p != '\0' && isspace((unsigned char)*p)) {
        ++p;
    }
    return p;
}

static const char *skip_str(const char *p)
{
    if (*p++ != '"') {
        return NULL;
    }
    while (*p != '\0' && *p != '"') {
        if (*p == '\\' || (unsigned char)*p < 0x20) {
            return NULL;
        }
        ++p;
    }
    return *p == '"' ? p + 1 : NULL;
}

static const char *skip_val(const char *p)
{
    p = ws(p);
    if (*p == '"') {
        return skip_str(p);
    }
    if (*p == '-' || isdigit((unsigned char)*p)) {
        if (*p == '-') {
            ++p;
        }
        if (!isdigit((unsigned char)*p)) {
            return NULL;
        }
        while (isdigit((unsigned char)*p)) {
            ++p;
        }
        return p;
    }
    static const char *lit[] = {"true", "false", "null"};
    for (size_t i = 0; i < sizeof(lit) / sizeof(lit[0]); ++i) {
        size_t n = strlen(lit[i]);
        if (strncmp(p, lit[i], n) == 0) {
            return p + n;
        }
    }
    return NULL;
}

static esp_err_t find_val(const char *json, const char *want, const char **val)
{
    if (json == NULL || want == NULL || val == NULL) {
        return ESP_ERR_INVALID_ARG;
    }
    const char *p = ws(json);
    if (*p++ != '{') {
        return ESP_ERR_INVALID_ARG;
    }
    p = ws(p);
    while (*p != '\0' && *p != '}') {
        if (*p != '"') {
            return ESP_ERR_INVALID_ARG;
        }
        const char *key = ++p;
        while (*p != '\0' && *p != '"') {
            if (*p == '\\' || (unsigned char)*p < 0x20) {
                return ESP_ERR_INVALID_ARG;
            }
            ++p;
        }
        if (*p != '"') {
            return ESP_ERR_INVALID_ARG;
        }
        size_t key_n = (size_t)(p - key);
        p = ws(p + 1);
        if (*p++ != ':') {
            return ESP_ERR_INVALID_ARG;
        }
        p = ws(p);
        if (strlen(want) == key_n && memcmp(key, want, key_n) == 0) {
            *val = p;
            return ESP_OK;
        }
        p = skip_val(p);
        if (p == NULL) {
            return ESP_ERR_INVALID_ARG;
        }
        p = ws(p);
        if (*p == ',') {
            p = ws(p + 1);
        } else if (*p != '}') {
            return ESP_ERR_INVALID_ARG;
        }
    }
    return ESP_ERR_NOT_FOUND;
}

esp_err_t js_str(const char *json, const char *key, char *out, size_t out_n)
{
    const char *p;
    if (out == NULL || out_n == 0) {
        return ESP_ERR_INVALID_ARG;
    }
    esp_err_t err = find_val(json, key, &p);
    if (err != ESP_OK || *p++ != '"') {
        return err == ESP_OK ? ESP_ERR_INVALID_ARG : err;
    }
    const char *end = p;
    while (*end != '\0' && *end != '"') {
        if (*end == '\\' || (unsigned char)*end < 0x20) {
            return ESP_ERR_INVALID_ARG;
        }
        ++end;
    }
    size_t n = (size_t)(end - p);
    if (*end != '"' || n >= out_n) {
        return ESP_ERR_INVALID_SIZE;
    }
    memcpy(out, p, n);
    out[n] = '\0';
    return ESP_OK;
}

esp_err_t js_u32(const char *json, const char *key, uint32_t *out)
{
    const char *p;
    if (out == NULL) {
        return ESP_ERR_INVALID_ARG;
    }
    esp_err_t err = find_val(json, key, &p);
    if (err != ESP_OK || !isdigit((unsigned char)*p)) {
        return err == ESP_OK ? ESP_ERR_INVALID_ARG : err;
    }
    uint64_t n = 0;
    while (isdigit((unsigned char)*p)) {
        n = n * 10 + (uint64_t)(*p++ - '0');
        if (n > UINT32_MAX) {
            return ESP_ERR_INVALID_SIZE;
        }
    }
    *out = (uint32_t)n;
    return ESP_OK;
}
