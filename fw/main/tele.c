#include "tele.h"

#include <stdbool.h>
#include <string.h>
#include "driver/gpio.h"
#include "driver/uart.h"
#include "esp_attr.h"
#include "esp_timer.h"
#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"
#include "freertos/task.h"

#define TE_CAP 24

static te_raw_t s_ring[TE_CAP];
static size_t s_head;
static size_t s_count;
static uint32_t s_seq;
static uint32_t s_drop;
static uint32_t s_ack;
static int64_t s_last;
static SemaphoreHandle_t s_mux;
static uint32_t s_orgms;
static bool s_orgok;
static bool s_ready;

#if C_ORGOK
static void IRAM_ATTR org_isr(void *arg)
{
    (void)arg;
    uint32_t ms = (uint32_t)(esp_timer_get_time() / 1000);
    __atomic_store_n(&s_orgms,
                     gpio_get_level(CFG_ORG) == 0 ? (ms == 0 ? 1 : ms) : 0,
                     __ATOMIC_RELEASE);
}

static esp_err_t org_init(void)
{
    gpio_config_t cfg = {
        .pin_bit_mask = 1ULL << CFG_ORG,
        .mode = GPIO_MODE_INPUT,
        .pull_up_en = GPIO_PULLUP_ENABLE,
        .pull_down_en = GPIO_PULLDOWN_DISABLE,
        .intr_type = GPIO_INTR_ANYEDGE,
    };
    esp_err_t err = gpio_config(&cfg);
    if (err != ESP_OK) {
        return err;
    }
    err = gpio_install_isr_service(0);
    if (err != ESP_OK && err != ESP_ERR_INVALID_STATE) {
        return err;
    }
    err = gpio_isr_handler_add(CFG_ORG, org_isr, NULL);
    if (err != ESP_OK) {
        return err;
    }
    org_isr(NULL);
    __atomic_store_n(&s_orgok, true, __ATOMIC_RELEASE);
    return ESP_OK;
}
#endif

static void push(int ch, const uint8_t *data, size_t len)
{
    if (xSemaphoreTake(s_mux, pdMS_TO_TICKS(50)) != pdTRUE) {
        __atomic_add_fetch(&s_drop, 1, __ATOMIC_RELAXED);
        return;
    }
    bool full = s_count == TE_CAP;
    uint32_t old = full ? s_ring[s_head].seq : 0;
    te_raw_t *raw = &s_ring[s_head];
    raw->seq = ++s_seq;
    raw->ms = (uint32_t)(esp_timer_get_time() / 1000);
    raw->ch = ch;
    raw->len = len > TE_DATA ? TE_DATA : len;
    memcpy(raw->data, data, raw->len);
    s_head = (s_head + 1) % TE_CAP;
    if (!full) {
        ++s_count;
    } else if (old > s_ack) {
        __atomic_add_fetch(&s_drop, 1, __ATOMIC_RELAXED);
    }
    s_last = esp_timer_get_time();
    xSemaphoreGive(s_mux);
}

static void rx_task(void *arg)
{
    int port = (int)(intptr_t)arg;
    uint8_t data[TE_DATA];
    for (;;) {
        int n = uart_read_bytes(port, data, sizeof(data), pdMS_TO_TICKS(100));
        if (n > 0) {
            push(port == UART_NUM_1 ? 0 : 1, data, n);
        }
    }
}

static esp_err_t uart_in(uart_port_t port, gpio_num_t rx)
{
    uart_config_t cfg = {
        .baud_rate = CFG_BAUD,
        .data_bits = UART_DATA_8_BITS,
        .parity = UART_PARITY_DISABLE,
        .stop_bits = UART_STOP_BITS_1,
        .flow_ctrl = UART_HW_FLOWCTRL_DISABLE,
        .source_clk = UART_SCLK_DEFAULT,
    };
    esp_err_t err = uart_driver_install(port, 1024, 0, 0, NULL, 0);
    if (err != ESP_OK) {
        return err;
    }
    err = uart_param_config(port, &cfg);
    if (err != ESP_OK) {
        return err;
    }
    return uart_set_pin(port, UART_PIN_NO_CHANGE, rx,
                        UART_PIN_NO_CHANGE, UART_PIN_NO_CHANGE);
}

esp_err_t te_init(void)
{
    s_mux = xSemaphoreCreateMutex();
    if (s_mux == NULL) {
        return ESP_ERR_NO_MEM;
    }
#if C_ORGOK
    esp_err_t err = org_init();
    if (err != ESP_OK) {
        return err;
    }
#else
    esp_err_t err;
#endif
    err = uart_in(UART_NUM_1, CFG_RX0);
    if (err != ESP_OK) {
        return err;
    }
    err = uart_in(UART_NUM_2, CFG_RX1);
    if (err != ESP_OK) {
        return err;
    }
    if (xTaskCreate(rx_task, "rx0", 2048, (void *)(intptr_t)UART_NUM_1,
                    4, NULL) != pdPASS ||
        xTaskCreate(rx_task, "rx1", 2048, (void *)(intptr_t)UART_NUM_2,
                    4, NULL) != pdPASS) {
        return ESP_ERR_NO_MEM;
    }
    __atomic_store_n(&s_ready, true, __ATOMIC_RELEASE);
    return ESP_OK;
}

td_state_t te_disp(void)
{
#if !CFG_RAW_OK && !C_ORGOK
    return TD_UNKNOWN;
#else
    if (!__atomic_load_n(&s_ready, __ATOMIC_ACQUIRE)) {
        return TD_UNKNOWN;
    }
    bool unk = false;
#if CFG_RAW_OK
    int64_t last = 0;
    if (s_mux == NULL || xSemaphoreTake(s_mux, pdMS_TO_TICKS(50)) != pdTRUE) {
        return TD_UNKNOWN;
    }
    last = s_last;
    xSemaphoreGive(s_mux);
    if (last == 0) {
        unk = true;
    } else if (esp_timer_get_time() - last < (int64_t)C_OFFMS * 1000) {
        return TD_ACTIVE;
    }
#endif
#if C_ORGOK
    if (!__atomic_load_n(&s_orgok, __ATOMIC_ACQUIRE)) {
        unk = true;
    } else if (gpio_get_level(CFG_ORG) != 0) {
        __atomic_store_n(&s_orgms, 0, __ATOMIC_RELEASE);
        return TD_ACTIVE;
    } else {
        uint32_t lo = __atomic_load_n(&s_orgms, __ATOMIC_ACQUIRE);
        uint32_t now = (uint32_t)(esp_timer_get_time() / 1000);
        if (lo == 0 || (uint32_t)(now - lo) < C_OFFMS) {
            return TD_ACTIVE;
        }
    }
#endif
    return unk ? TD_UNKNOWN : TD_OFF;
#endif
}

const char *te_name(td_state_t state)
{
    switch (state) {
    case TD_ACTIVE: return "active";
    case TD_OFF: return "off";
    default: return "unknown";
    }
}

esp_err_t te_snap(uint32_t after, te_snap_t *snap)
{
    if (snap == NULL || s_mux == NULL) {
        return ESP_ERR_INVALID_ARG;
    }
    if (xSemaphoreTake(s_mux, pdMS_TO_TICKS(100)) != pdTRUE) {
        return ESP_ERR_TIMEOUT;
    }
    memset(snap, 0, sizeof(*snap));
    uint32_t seen = after > s_seq ? s_seq : after;
    if (seen > s_ack) {
        s_ack = seen;
    }
    snap->seq = after;
    snap->top = s_seq;
    snap->drop = __atomic_load_n(&s_drop, __ATOMIC_RELAXED);
    snap->ms = (uint32_t)(esp_timer_get_time() / 1000);

    size_t start = (s_head + TE_CAP - s_count) % TE_CAP;
    for (size_t i = 0; i < s_count && snap->count < C_RAWMAX; ++i) {
        const te_raw_t *raw = &s_ring[(start + i) % TE_CAP];
        if (raw->seq > after) {
            snap->raw[snap->count++] = *raw;
            snap->seq = raw->seq;
        }
    }
    xSemaphoreGive(s_mux);
    return ESP_OK;
}
