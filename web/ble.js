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
      throw new Error("Web Bluetooth needs Android Chrome on a secure browser origin.");
    }
    this.drop(false);
    const dev = await navigator.bluetooth.requestDevice({
      filters: [{ services: [UUID.svc] }],
    });
    await this.useDev(dev);
  }

  async resume(id) {
    if (!BleLink.ok() || !("getDevices" in navigator.bluetooth)) {
      throw new Error("Saved Bluetooth devices are not available in this browser.");
    }
    this.drop(false);
    const devs = await this.limit(navigator.bluetooth.getDevices(), CFG.recon);
    const dev = devs.find((item) => item.id === id);
    if (!dev) throw new Error("The saved scooter Bluetooth permission is unavailable.");
    // Service discovery can take several seconds after an ESP starts
    // advertising. Do not cut a valid reconnect off after one retry period.
    await this.useDev(dev, CFG.gatt);
  }

  async useDev(dev, tout = 0) {
    const due = tout ? performance.now() + tout : 0;
    const left = () => due ? Math.max(1, due - performance.now()) : 0;
    this.dev = dev;
    dev.addEventListener("gattserverdisconnected", this.onOff);
    try {
      const gatt = await this.limit(dev.gatt.connect(), left());
      if (this.dev !== dev) throw new Error("Bluetooth attempt ended.");
      const srv = await this.limit(gatt.getPrimaryService(UUID.svc), left());
      if (this.dev !== dev) throw new Error("Bluetooth attempt ended.");
      this.srv = srv;
      for (const name of ["ver", "sec", "ctrl"]) {
        const chr = await this.limit(this.srv.getCharacteristic(UUID[name]), left());
        if (this.dev !== dev) throw new Error("Bluetooth attempt ended.");
        this.chr.set(name, chr);
      }
      this.dispatchEvent(new Event("bleon"));
    } catch (err) {
      if (this.dev === dev) {
        if (dev.gatt?.connected) dev.gatt.disconnect();
        this.drop(false);
      }
      throw err;
    }
  }

  limit(job, tout) {
    if (!tout) return job;
    let timer;
    const wait = new Promise((_, reject) => {
      timer = window.setTimeout(() => reject(new Error("Bluetooth reconnect timed out.")), tout);
    });
    return Promise.race([job, wait]).finally(() => window.clearTimeout(timer));
  }

  close() {
    if (this.dev?.gatt?.connected) {
      this.dev.gatt.disconnect();
    } else {
      this.drop(true);
    }
  }

  async readVer(tout = CFG.tout) {
    return this.xchg("ver", Uint8Array.of(0), tout);
  }

  async xchg(name, data, tout = CFG.tout) {
    if (!["ver", "sec", "ctrl"].includes(name)) {
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
