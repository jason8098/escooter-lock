// Minimal codec for ESP-IDF v6.0.2 protocomm Security 2 messages.
// Schema source:
// https://github.com/espressif/esp-idf/tree/v6.0.2/components/protocomm/proto

export class PbErr extends Error {
  constructor(msg) {
    super(msg);
    this.name = "PbErr";
  }
}

function bytes(val) {
  if (val instanceof Uint8Array) return val;
  if (val instanceof ArrayBuffer) return new Uint8Array(val);
  if (ArrayBuffer.isView(val)) {
    return new Uint8Array(val.buffer, val.byteOffset, val.byteLength);
  }
  throw new PbErr("Invalid security packet.");
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

function vint(val) {
  let num = BigInt(val);
  if (num < 0n) throw new PbErr("Invalid security packet.");
  const out = [];
  do {
    let oct = Number(num & 0x7fn);
    num >>= 7n;
    if (num) oct |= 0x80;
    out.push(oct);
  } while (num);
  return Uint8Array.from(out);
}

function vfld(num, val) {
  return join(vint((num << 3) | 0), vint(val));
}

function bfld(num, val) {
  const data = bytes(val);
  return join(vint((num << 3) | 2), vint(data.length), data);
}

class Read {
  constructor(data) {
    this.data = bytes(data);
    this.pos = 0;
  }

  varint() {
    let val = 0n;
    for (let idx = 0; idx < 10; idx += 1) {
      if (this.pos >= this.data.length) {
        throw new PbErr("Truncated security packet.");
      }
      const oct = this.data[this.pos++];
      val |= BigInt(oct & 0x7f) << BigInt(idx * 7);
      if (!(oct & 0x80)) return val;
    }
    throw new PbErr("Invalid security packet.");
  }

  take(size) {
    if (!Number.isSafeInteger(size) || size < 0 ||
        this.pos + size > this.data.length) {
      throw new PbErr("Truncated security packet.");
    }
    const out = this.data.slice(this.pos, this.pos + size);
    this.pos += size;
    return out;
  }
}

function parse(data, allow) {
  const rd = new Read(data);
  const out = new Map();
  while (rd.pos < rd.data.length) {
    const key = rd.varint();
    const num = Number(key >> 3n);
    const wire = Number(key & 7n);
    if (!num || !allow.has(num) || out.has(num)) {
      throw new PbErr("Unexpected security packet.");
    }
    let val;
    if (wire === 0) {
      val = rd.varint();
    } else if (wire === 2) {
      const size = Number(rd.varint());
      val = rd.take(size);
    } else {
      throw new PbErr("Unexpected security packet.");
    }
    out.set(num, { wire, val });
  }
  return out;
}

function one(map, num, wire, req = true) {
  const item = map.get(num);
  if (!item) {
    if (req) throw new PbErr("Incomplete security packet.");
    return null;
  }
  if (item.wire !== wire) throw new PbErr("Invalid security packet.");
  return item.val;
}

function sess(data) {
  const top = parse(data, new Set([2, 12]));
  const ver = one(top, 2, 0);
  if (ver !== 2n) throw new PbErr("Security version mismatch.");
  return one(top, 12, 2);
}

function stat(map) {
  const val = one(map, 1, 0, false);
  const code = val === null ? 0n : val;
  if (code !== 0n) throw new PbErr("Security handshake was rejected.");
}

function wrap(pay) {
  return join(vfld(2, 2), bfld(12, pay));
}

export function enc0(user, pub) {
  const cmd = join(bfld(1, user), bfld(2, pub));
  // S2Session_Command0 is enum zero and is omitted by proto3.
  return wrap(bfld(20, cmd));
}

export function dec0(data) {
  const pay = parse(sess(data), new Set([1, 21]));
  const kind = one(pay, 1, 0);
  if (kind !== 1n) throw new PbErr("Unexpected security response.");
  const rsp = parse(one(pay, 21, 2), new Set([1, 2, 3]));
  stat(rsp);
  const pub = one(rsp, 2, 2);
  const salt = one(rsp, 3, 2);
  if (!pub.length || pub.length > 384 || salt.length !== 16) {
    throw new PbErr("Invalid security parameters.");
  }
  return { pub, salt };
}

export function enc1(proof) {
  const cmd = bfld(1, proof);
  const pay = join(vfld(1, 2), bfld(22, cmd));
  return wrap(pay);
}

export function dec1(data) {
  const pay = parse(sess(data), new Set([1, 23]));
  const kind = one(pay, 1, 0);
  if (kind !== 3n) throw new PbErr("Unexpected security response.");
  const rsp = parse(one(pay, 23, 2), new Set([1, 2, 3]));
  stat(rsp);
  const proof = one(rsp, 2, 2);
  const nonce = one(rsp, 3, 2);
  if (proof.length !== 64 || nonce.length !== 12) {
    throw new PbErr("Invalid security proof.");
  }
  return { proof, nonce };
}
