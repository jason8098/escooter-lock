import { PbErr, dec0, dec1, enc0, enc1 } from "./pb.js";

// ESP-IDF Security 2 sources used for this implementation:
// https://github.com/espressif/esp-idf/blob/v6.0.2/components/protocomm/src/security/security2.c
// https://github.com/espressif/esp-idf/blob/v6.0.2/components/protocomm/src/crypto/srp6a/esp_srp.c
// https://github.com/espressif/esp-idf/blob/v6.0.2/components/protocomm/test_apps/main/test_srp.c
// https://github.com/espressif/esp-idf-provisioning-android/blob/master/provisioning/src/main/java/com/espressif/provisioning/security/Security2.java

const NHEX =
  "FFFFFFFFFFFFFFFFC90FDAA22168C234C4C6628B80DC1CD1" +
  "29024E088A67CC74020BBEA63B139B22514A08798E3404DD" +
  "EF9519B3CD3A431B302B0A6DF25F14374FE1356D6D51C245" +
  "E485B576625E7EC6F44C42E9A637ED6B0BFF5CB6F406B7ED" +
  "EE386BFB5A899FA5AE9F24117C4B1FE649286651ECE45B3D" +
  "C2007CB8A163BF0598DA48361C55D39A69163FA8FD24CF5F" +
  "83655D23DCA3AD961C62F356208552BB9ED529077096966D" +
  "670C354E4ABC9804F1746C08CA18217C32905E462E36CE3B" +
  "E39E772C180E86039B2783A2EC07A28FB5C55DF06F4C52C" +
  "9DE2BCBF6955817183995497CEA956AE515D2261898FA0510" +
  "15728E5A8AAAC42DAD33170D04507A33A85521ABDF1CBA64" +
  "ECFB850458DBEF0A8AEA71575D060C7DB3970F85A6E1E4C7" +
  "ABF5AE8CDB0933D71E8C94E04A25619DCEE3D2261AD2EE6" +
  "BF12FFA06D98A0864D87602733EC86A64521F2B18177B200" +
  "CBBE117577A615D6C770988C0BAD946E208E24FA074E5AB31" +
  "43DB5BFCE0FD108E4B82D120A93AD2CAFFFFFFFFFFFFFFFF";

const N = BigInt(`0x${NHEX}`);
const G = 5n;
const NLEN = 384;
const ENC = new TextEncoder();
const VSALT = Uint8Array.of(
  0x03, 0x6e, 0xe0, 0xc7, 0xbc, 0xb9, 0xed, 0xa8,
  0x4c, 0x9e, 0xac, 0x97, 0xd9, 0x3d, 0xec, 0xf4,
);
const VHASH = Uint8Array.of(
  0xe9, 0x85, 0xf1, 0xfb, 0x10, 0xe7, 0xc5, 0xaa,
  0xf6, 0x25, 0xec, 0x7c, 0xc0, 0x89, 0x6e, 0x8f,
  0x92, 0xbd, 0xcd, 0x5b, 0x62, 0x11, 0x41, 0x76,
  0x6e, 0xa6, 0xea, 0x93, 0xbd, 0x89, 0x9b, 0x06,
);
let vtest = null;

export class SecErr extends Error {
  constructor(msg, code = "SEC") {
    super(msg);
    this.name = "SecErr";
    this.code = code;
  }
}

function u8(val) {
  if (val instanceof Uint8Array) return val;
  if (val instanceof ArrayBuffer) return new Uint8Array(val);
  if (ArrayBuffer.isView(val)) {
    return new Uint8Array(val.buffer, val.byteOffset, val.byteLength);
  }
  throw new SecErr("Invalid secure data.", "INPUT");
}

function join(...list) {
  let size = 0;
  for (const item of list) size += item.length;
  const out = new Uint8Array(size);
  let pos = 0;
  for (const item of list) {
    out.set(item, pos);
    pos += item.length;
  }
  return out;
}

function big(data) {
  let val = 0n;
  for (const oct of data) val = (val << 8n) | BigInt(oct);
  return val;
}

function raw(val) {
  if (val < 0n) throw new SecErr("Invalid security value.", "PROTO");
  if (val === 0n) return new Uint8Array(0);
  const out = [];
  let num = val;
  while (num) {
    out.push(Number(num & 0xffn));
    num >>= 8n;
  }
  out.reverse();
  return Uint8Array.from(out);
}

function pad(val, size) {
  const src = raw(val);
  if (src.length > size) {
    throw new SecErr("Invalid security value.", "PROTO");
  }
  const out = new Uint8Array(size);
  out.set(src, size - src.length);
  return out;
}

function pow(base, exp, mod) {
  if (mod <= 0n || exp < 0n) {
    throw new SecErr("Invalid security value.", "PROTO");
  }
  let out = 1n;
  let cur = ((base % mod) + mod) % mod;
  let num = exp;
  while (num) {
    if (num & 1n) out = (out * cur) % mod;
    num >>= 1n;
    if (num) cur = (cur * cur) % mod;
  }
  return out;
}

async function hash(...list) {
  const buf = join(...list);
  const out = await globalThis.crypto.subtle.digest("SHA-512", buf);
  return new Uint8Array(out);
}

function count(val) {
  return [...val].length;
}

function badUtf(val) {
  for (const chr of val) {
    if (chr.length === 1) {
      const num = chr.charCodeAt(0);
      if (num >= 0xd800 && num <= 0xdfff) return true;
    }
  }
  return false;
}

function check(user, pass) {
  if (typeof user !== "string" || !user.length || count(user) > 64 ||
      badUtf(user)) {
    throw new SecErr("Invalid device username.", "INPUT");
  }
  if (typeof pass !== "string" || count(pass) < 10 ||
      count(pass) > 64 || badUtf(pass)) {
    throw new SecErr("Passcode must contain 10 to 64 characters.", "INPUT");
  }
  const ubuf = ENC.encode(user);
  const pbuf = ENC.encode(pass);
  if (!ubuf.length || ubuf.length > 0xffff || !pbuf.length) {
    throw new SecErr("Invalid credentials.", "INPUT");
  }
  return { ubuf, pbuf };
}

async function getX(salt, ubuf, pbuf) {
  const inner = await hash(ubuf, Uint8Array.of(0x3a), pbuf);
  return big(await hash(salt, inner));
}

function rand() {
  let val = 0n;
  while (!val) {
    const buf = new Uint8Array(32);
    globalThis.crypto.getRandomValues(buf);
    val = big(buf);
    buf.fill(0);
  }
  return val;
}

function same(one, two) {
  if (one.length !== two.length) return false;
  let diff = 0;
  for (let idx = 0; idx < one.length; idx += 1) {
    diff |= one[idx] ^ two[idx];
  }
  return diff === 0;
}

function need() {
  if (!SecCli.ok()) {
    throw new SecErr("Secure browser cryptography is unavailable.", "UNSUP");
  }
}

async function self() {
  if (vtest) return vtest;
  vtest = (async () => {
    const ubuf = ENC.encode("wifiprov");
    const pbuf = ENC.encode("abcd1234");
    let ver = null;
    try {
      const x = await getX(VSALT, ubuf, pbuf);
      ver = pad(pow(G, x, N), NLEN);
      const rawSum = await globalThis.crypto.subtle.digest("SHA-256", ver);
      if (!same(new Uint8Array(rawSum), VHASH)) {
        throw new SecErr("Browser security self-check failed.", "CRYPTO");
      }
      return true;
    } finally {
      ubuf.fill(0);
      pbuf.fill(0);
      if (ver) ver.fill(0);
    }
  })();
  try {
    return await vtest;
  } catch (err) {
    vtest = null;
    throw err;
  }
}

export async function makeCred(user, pass) {
  need();
  const { ubuf, pbuf } = check(user, pass);
  const salt = new Uint8Array(16);
  let ver = null;
  try {
    await self();
    globalThis.crypto.getRandomValues(salt);
    const x = await getX(salt, ubuf, pbuf);
    ver = pad(pow(G, x, N), NLEN);
    return { salt: salt.slice(), ver: ver.slice() };
  } finally {
    salt.fill(0);
    if (ver) ver.fill(0);
    ubuf.fill(0);
    pbuf.fill(0);
  }
}

export class SecCli {
  constructor(opts = {}) {
    if (typeof opts.send !== "function") {
      throw new SecErr("Secure transport is unavailable.", "INPUT");
    }
    this.send = opts.send;
    this.key = null;
    this.sid = null;
    this.ctr = 0;
    this.on = false;
    this.busy = false;
  }

  static ok() {
    return typeof BigInt === "function" &&
      typeof TextEncoder === "function" &&
      !!globalThis.crypto?.subtle &&
      typeof globalThis.crypto.getRandomValues === "function";
  }

  get active() {
    return this.on;
  }

  _clear() {
    if (this.sid) this.sid.fill(0);
    this.key = null;
    this.sid = null;
    this.ctr = 0;
    this.on = false;
  }

  close() {
    this._clear();
  }

  async open(opts = {}) {
    need();
    const { ubuf, pbuf } = check(opts.user, opts.pass);
    if (this.busy) {
      throw new SecErr("A security operation is already running.", "BUSY");
    }
    this._clear();
    this.busy = true;
    let skey = null;
    let m1 = null;
    let aesRaw = null;
    try {
      await self();
      const aval = rand();
      const apub = pad(pow(G, aval, N), NLEN);
      const pkt0 = await this.send(enc0(ubuf, apub));
      const rsp0 = dec0(u8(pkt0));
      const bval = big(rsp0.pub);
      if (bval <= 0n || bval >= N || bval % N === 0n) {
        throw new SecErr("Invalid device security key.", "PROTO");
      }

      const nbuf = pad(N, NLEN);
      const gbuf = pad(G, NLEN);
      const kval = big(await hash(nbuf, gbuf));
      const uval = big(await hash(apub, pad(bval, NLEN)));
      if (!uval) throw new SecErr("Invalid security exchange.", "PROTO");

      const xval = await getX(rsp0.salt, ubuf, pbuf);
      const gx = pow(G, xval, N);
      const base = (bval - ((kval * gx) % N) + N) % N;
      if (!base) throw new SecErr("Invalid security exchange.", "PROTO");
      const sval = pow(base, aval + uval * xval, N);
      if (!sval) throw new SecErr("Invalid security exchange.", "PROTO");
      skey = await hash(raw(sval));

      const hn = await hash(nbuf);
      const hg = await hash(gbuf);
      const mix = new Uint8Array(hn.length);
      for (let idx = 0; idx < mix.length; idx += 1) {
        mix[idx] = hn[idx] ^ hg[idx];
      }
      const hi = await hash(ubuf);
      m1 = await hash(mix, hi, rsp0.salt, apub, rsp0.pub, skey);

      const pkt1 = await this.send(enc1(m1));
      const rsp1 = dec1(u8(pkt1));
      const want = await hash(apub, m1, skey);
      if (!same(want, rsp1.proof)) {
        throw new SecErr("Passcode or device proof is invalid.", "AUTH");
      }

      const view = new DataView(
        rsp1.nonce.buffer,
        rsp1.nonce.byteOffset + 8,
        4,
      );
      const ctr = view.getUint32(0, false);
      if (ctr !== 1) {
        throw new SecErr("Unsupported security counter.", "PROTO");
      }
      aesRaw = skey.slice(0, 32);
      const aes = await globalThis.crypto.subtle.importKey(
        "raw",
        aesRaw,
        { name: "AES-GCM" },
        false,
        ["encrypt", "decrypt"],
      );
      this.key = aes;
      this.sid = rsp1.nonce.slice(0, 8);
      this.ctr = ctr;
      this.on = true;
    } catch (err) {
      this._clear();
      if (err instanceof SecErr) throw err;
      if (err instanceof PbErr) {
        throw new SecErr(err.message, "PROTO");
      }
      throw new SecErr("Secure connection failed.", "AUTH");
    } finally {
      if (skey) skey.fill(0);
      if (m1) m1.fill(0);
      if (aesRaw) aesRaw.fill(0);
      ubuf.fill(0);
      pbuf.fill(0);
      this.busy = false;
    }
  }

  _ready(path) {
    if (!this.on || !this.key || !this.sid) {
      throw new SecErr("Authenticate before sending a command.", "STATE");
    }
    if (typeof path !== "string" || !path.length) {
      throw new SecErr("Invalid secure endpoint.", "INPUT");
    }
    if (this.busy) {
      throw new SecErr("A security operation is already running.", "BUSY");
    }
  }

  _iv() {
    const iv = new Uint8Array(12);
    iv.set(this.sid, 0);
    new DataView(iv.buffer).setUint32(8, this.ctr, false);
    return iv;
  }

  async wrap(path, plain) {
    this._ready(path);
    if (this.ctr === 0xffffffff) {
      this._clear();
      throw new SecErr("Secure session expired. Reconnect to continue.", "EXPIRE");
    }
    const data = u8(plain);
    this.busy = true;
    try {
      // ESP-IDF Security 2 patch 1 uses no AAD; path is transport routing only.
      const out = await globalThis.crypto.subtle.encrypt(
        { name: "AES-GCM", iv: this._iv(), tagLength: 128 },
        this.key,
        data,
      );
      if (!this.on) throw new SecErr("Secure session was closed.", "STATE");
      this.ctr += 1;
      return new Uint8Array(out);
    } catch (err) {
      this._clear();
      if (err instanceof SecErr) throw err;
      throw new SecErr("Command encryption failed. Reconnect to continue.", "CRYPTO");
    } finally {
      this.busy = false;
    }
  }

  async unwrap(path, cipher) {
    this._ready(path);
    const data = u8(cipher);
    if (data.length < 16) {
      this._clear();
      throw new SecErr("Invalid encrypted response.", "PROTO");
    }
    this.busy = true;
    try {
      const out = await globalThis.crypto.subtle.decrypt(
        { name: "AES-GCM", iv: this._iv(), tagLength: 128 },
        this.key,
        data,
      );
      if (!this.on) throw new SecErr("Secure session was closed.", "STATE");
      if (this.ctr === 0xffffffff) {
        this._clear();
      } else {
        this.ctr += 1;
      }
      return new Uint8Array(out);
    } catch (err) {
      this._clear();
      if (err instanceof SecErr) throw err;
      throw new SecErr("Response authentication failed. Reconnect to continue.", "CRYPTO");
    } finally {
      this.busy = false;
    }
  }
}
