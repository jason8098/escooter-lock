import { CFG, UUID } from "./cfg.js";

class GattQ {
  constructor() {
    this.tail = Promise.resolve();
  }

  add(job) {
    const next = this.tail.then(job, job);
    this.tail = next.catch(() => {});
    return next;
  }
}

export class BleLink extends EventTarget {
  constructor() {
    super();
    this.dev = null;
    this.srv = null;
    this.chr = new Map();
    this.q = new GattQ();
    this.onOff = () => this.drop(true);
  }

  static ok() {
    return window.isSecureContext && "bluetooth" in navigator;
  }

  get linked() {
    return Boolean(this.dev?.gatt?.connected && this.srv);
  }

  async open() {
    if (!BleLink.ok()) {
      throw new Error("Web Bluetooth needs Android Chrome on HTTPS.");
    }
    this.drop(false);
    const dev = await navigator.bluetooth.requestDevice({
      filters: [{ services: [UUID.svc] }],
    });
    this.dev = dev;
    dev.addEventListener("gattserverdisconnected", this.onOff);

    try {
      const gatt = await dev.gatt.connect();
      this.srv = await gatt.getPrimaryService(UUID.svc);
      for (const name of ["ver", "sec", "ctrl", "tele"]) {
        const chr = await this.srv.getCharacteristic(UUID[name]);
        this.chr.set(name, chr);
      }
      this.dispatchEvent(new Event("bleon"));
    } catch (err) {
      if (dev.gatt?.connected) dev.gatt.disconnect();
      this.drop(false);
      throw err;
    }
  }

  close() {
    if (this.dev?.gatt?.connected) {
      this.dev.gatt.disconnect();
    } else {
      this.drop(true);
    }
  }

  async readVer() {
    return this.xchg("ver", Uint8Array.of(0));
  }

  async xchg(name, data, tout = CFG.tout) {
    if (!["ver", "sec", "ctrl", "tele"].includes(name)) {
      throw new Error("Invalid Bluetooth endpoint.");
    }
    return this.q.add(async () => {
      this.need(name);
      const chr = this.chr.get(name);
      const work = async () => {
        const val = data instanceof Uint8Array ? data : new Uint8Array(data);
        if (chr.properties.write) {
          await chr.writeValueWithResponse(val);
        } else {
          throw new Error("Bluetooth endpoint does not support request writes.");
        }
        const reply = await chr.readValue();
        return this.copy(reply);
      };
      let timer;
      const limit = new Promise((_, reject) => {
        timer = window.setTimeout(() => {
          this.close();
          reject(new Error("The scooter did not respond in time."));
        }, tout);
      });
      return Promise.race([work(), limit]).finally(() => window.clearTimeout(timer));
    });
  }

  need(name) {
    if (!this.linked || !this.chr.has(name)) {
      throw new Error("Connect to the scooter first.");
    }
  }

  copy(val) {
    return new Uint8Array(val.buffer, val.byteOffset, val.byteLength).slice();
  }

  drop(emit) {
    if (this.dev) {
      this.dev.removeEventListener("gattserverdisconnected", this.onOff);
    }
    this.chr.clear();
    this.srv = null;
    this.dev = null;
    this.q = new GattQ();
    if (emit) this.dispatchEvent(new Event("bleoff"));
  }
}
