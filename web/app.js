import { BleLink } from "./ble.js";
import { CFG } from "./cfg.js";
import { SecCli, makeCred } from "./sec.js";

const ENC = new TextEncoder();
const DEC = new TextDecoder("utf-8", { fatal: true });
const VIEWS = ["control", "live", "setup"];
const ble = new BleLink();

let sec = null;
let info = {};
let rid = 0;
let txTail = Promise.resolve();
let pollId = 0;
let teleBusy = false;
let hold = null;
let holdNo = 0;
let busy = false;

const cur = {
  auth: false,
  state: "UNKNOWN",
  disp: "UNKNOWN",
  gate: "",
  fault: "",
  seq: 0,
  drop: 0,
  seen: false,
};

function el(id) {
  return document.getElementById(id);
}

function text(id, val) {
  el(id).textContent = val;
}

function showMsg(val, kind = "danger") {
  const box = el("msg");
  box.className = `alert alert-${kind} mb-3`;
  box.textContent = val;
}

function hideMsg() {
  el("msg").className = "alert d-none mb-3";
  el("msg").textContent = "";
}

function errMsg(err) {
  if (err?.name === "NotFoundError") return "No Bluetooth device was selected.";
  if (err?.name === "SecurityError") return "Bluetooth access was blocked by the browser.";
  return err?.message || "The request could not be completed.";
}

function nextId() {
  rid = (rid % 0xfffffffe) + 1;
  return rid;
}

function parse(data) {
  let val;
  try {
    val = JSON.parse(DEC.decode(data));
  } catch {
    throw new Error("The scooter returned an invalid response.");
  }
  if (!val || typeof val !== "object" || Array.isArray(val)) {
    throw new Error("The scooter returned an invalid response.");
  }
  return val;
}

function tx(job) {
  const next = txTail.then(job, job);
  txTail = next.catch(() => {});
  return next;
}

async function call(path, plain) {
  return tx(async () => {
    if (!cur.auth || !sec?.active) {
      throw new Error("Authenticate before sending a command.");
    }
    try {
      const enc = await sec.wrap(path, plain);
      const raw = await ble.xchg(path, enc);
      return await sec.unwrap(path, raw);
    } catch (err) {
      sec?.close();
      cur.auth = false;
      ble.close();
      throw err;
    }
  });
}

function codeMsg(code) {
  const list = {
    bad_req: "The command was rejected as invalid.",
    bad_ver: "The scooter firmware is not compatible with this app.",
    bad_id: "The secure request sequence was rejected. Reconnect and try again.",
    not_off: "Turn off the scooter display before locking.",
    not_ready: "The relay state is not ready to lock.",
    wait: "Keep holding the Lock button.",
    expired: "The lock hold expired. Press and hold again.",
    fault: "Relay feedback reported a fault.",
    repeat: "That lock authorization was already used.",
    claim_only: "Finish owner setup before using scooter controls.",
    reconnect: "The passphrase changed. Reconnect to continue.",
    internal: "The scooter could not complete the command.",
    ok: "",
  };
  return list[code] || "The scooter rejected the command.";
}

function applyCtl(rsp) {
  if (typeof rsp.state === "string") cur.state = rsp.state.toUpperCase();
  if (typeof rsp.disp === "string") cur.disp = rsp.disp.toUpperCase();
  cur.gate = typeof rsp.gate === "string" ? rsp.gate : "";
  cur.fault = typeof rsp.fault === "string" ? rsp.fault : "";
  paint();
}

function checkRsp(rsp, id) {
  if (rsp.v !== 1 || rsp.id !== id) {
    throw new Error("The scooter response did not match this request.");
  }
}

async function ctrl(op, extra = {}) {
  const id = nextId();
  const req = ENC.encode(JSON.stringify({ v: 1, id, op, ...extra }));
  let rsp;
  try {
    rsp = parse(await call("ctrl", req));
    checkRsp(rsp, id);
  } catch (err) {
    sec?.close();
    cur.auth = false;
    ble.close();
    throw err;
  }
  applyCtl(rsp);
  if (!rsp.ok) {
    const err = new Error(codeMsg(rsp.gate || rsp.err));
    err.code = rsp.gate || rsp.err;
    throw err;
  }
  return rsp;
}

async function newReq(cred) {
  if (!(cred.salt instanceof Uint8Array) || cred.salt.length !== 16 ||
      !(cred.ver instanceof Uint8Array) || cred.ver.length !== 384) {
    throw new Error("The passphrase verifier could not be created.");
  }
  const id = nextId();
  const req = new Uint8Array(406);
  req[0] = 1;
  req[1] = 5;
  new DataView(req.buffer).setUint32(2, id, false);
  req.set(cred.salt, 6);
  req.set(cred.ver, 22);
  try {
    let rsp;
    try {
      rsp = parse(await call("ctrl", req));
      checkRsp(rsp, id);
    } catch (err) {
      sec?.close();
      cur.auth = false;
      ble.close();
      throw err;
    }
    applyCtl(rsp);
    if (!rsp.ok) throw new Error(codeMsg(rsp.gate || rsp.err));
    return rsp;
  } finally {
    req.fill(0);
    cred.salt.fill(0);
    cred.ver.fill(0);
  }
}

function modeUser() {
  return "owner";
}

function setInfo(data) {
  const app = data.app;
  if (!app || typeof app !== "object") {
    throw new Error("The scooter version response is invalid.");
  }
  info = app;
  text("devName", ble.dev?.name || "Scooter Lock");
  text("devId", typeof app.id === "string" ? app.id : "—");
  text("proto", app.ver ? `${app.ver} (protocol ${app.proto ?? "—"})` : String(app.proto ?? "—"));
  text("caps", Array.isArray(app.cap) ? app.cap.join(", ") : "—");
  const good = app.proto === 1 && app.sec === 2 && app.sec_patch_ver === 1 &&
    ["owned", "claim"].includes(app.mode);
  if (!good) {
    text("compat", "Connected, but this firmware security version is not supported.");
    throw new Error("This scooter firmware is not compatible with the app.");
  }
  if (app.mode === "claim") {
    el("pass").placeholder = "Enter the one-time USB setup code";
    text("authText", "Use the one-time setup code shown over USB. It is cleared after use.");
  } else {
    el("pass").placeholder = "Enter your passphrase";
    text("authText", "Your passphrase stays in this page only and is cleared after use.");
  }
  text("compat", "Compatible secure firmware detected.");
}

function stateName() {
  const names = {
    LOCKED: "Locked",
    READY: "Unlocked",
    FAULT: "Lock fault",
    UNKNOWN: "State unknown",
  };
  return names[cur.state] || "State unknown";
}

function gateMsg(auth) {
  if (!auth) return "Locking is available after authentication.";
  if (info.mode === "claim") return "Finish owner setup before using scooter controls.";
  if (cur.state === "FAULT") return cur.fault || "Relay feedback must be checked.";
  if (cur.state === "LOCKED") return "Scooter is already locked.";
  if (cur.disp !== "OFF") return "Turn off the scooter display before locking.";
  if (cur.gate && cur.gate !== "ok") return codeMsg(cur.gate);
  return "Press and hold for three seconds to lock.";
}

function paint() {
  const linked = ble.linked;
  const auth = linked && cur.auth && sec?.active;
  const claim = auth && info.mode === "claim";
  const held = Boolean(hold);
  const top = claim ? "Setup required" : auth ? stateName() : linked ? "Connected" : "Offline";
  text("topStat", top);
  el("topStat").className = `badge ${auth ? (cur.state === "FAULT" ? "text-bg-warning" : "text-bg-primary") : linked ? "text-bg-info" : "text-bg-secondary"}`;

  text("connText", linked ? `Connected to ${ble.dev?.name || "Scooter Lock"}.` : "Connect when you are near the scooter.");
  el("connDot").className = `dot ${linked ? "on" : "off"}`;
  el("connBtn").classList.toggle("d-none", linked);
  el("discBtn").classList.toggle("d-none", !linked);
  el("connBtn").disabled = busy || !BleLink.ok() || !SecCli.ok();
  el("discBtn").disabled = busy;
  el("pass").disabled = !linked || !sec || auth || busy;
  el("authBtn").disabled = !linked || !sec || auth || busy;
  el("logBtn").classList.toggle("d-none", !auth);
  el("logBtn").disabled = busy;

  const ring = el("stateRing");
  ring.className = `state-ring ${auth ? cur.state.toLowerCase() : "unknown"} mx-auto mb-3`;
  text("stateIcon", !auth ? "?" : cur.state === "LOCKED" ? "L" : cur.state === "READY" ? "U" : cur.state === "FAULT" ? "!" : "?");
  text("lockText", auth ? stateName() : "State unknown");
  if (!auth) {
    text("dispText", linked ? "Authenticate to confirm the relay." : "Connect and authenticate to confirm the relay.");
  } else if (cur.disp === "ACTIVE") {
    text("dispText", "Scooter display is on.");
  } else if (cur.disp === "OFF") {
    text("dispText", "Scooter display is off.");
  } else {
    text("dispText", "Display state is unknown.");
  }

  el("openBtn").disabled = !auth || claim || busy || held || cur.state === "READY" || cur.state === "FAULT";
  const canLock = auth && !claim && !busy && cur.state === "READY" && cur.disp === "OFF";
  el("lockBtn").disabled = !canLock;
  text("gateText", gateMsg(auth));

  for (const id of ["newPass", "pass2", "passBtn"]) {
    el(id).disabled = !auth || busy || held;
  }
  paintTele();
}

function paintTele() {
  const auth = ble.linked && cur.auth && sec?.active && info.mode !== "claim";
  const badge = el("teleStat");
  badge.className = `badge ${cur.seen ? "text-bg-success" : "text-bg-secondary"}`;
  badge.textContent = cur.seen ? "Live" : auth ? "Waiting" : "Unavailable";
}

function resetTele() {
  cur.seq = 0;
  cur.drop = 0;
  cur.seen = false;
  for (const id of ["speed", "bat", "volt", "amps", "power", "temp", "odo"]) {
    text(id, "—");
  }
  text("faults", "No verified data.");
  text("teleTime", "Waiting for an authenticated connection.");
  paintTele();
}

function endAuth() {
  stopHold();
  stopPoll();
  sec?.close();
  sec = null;
  cur.auth = false;
  cur.state = "UNKNOWN";
  cur.disp = "UNKNOWN";
  cur.gate = "";
  cur.fault = "";
  txTail = Promise.resolve();
  el("pass").value = "";
  el("newPass").value = "";
  el("pass2").value = "";
  resetTele();
  paint();
}

async function connect() {
  hideMsg();
  busy = true;
  paint();
  try {
    await ble.open();
    setInfo(parse(await ble.readVer()));
    sec = new SecCli({ send: (data) => ble.xchg("sec", data) });
  } catch (err) {
    ble.close();
    showMsg(errMsg(err));
  } finally {
    busy = false;
    paint();
  }
}

async function auth(ev) {
  ev.preventDefault();
  hideMsg();
  const field = el("pass");
  let pass = field.value;
  field.value = "";
  busy = true;
  paint();
  try {
    if (!sec) throw new Error("Connect to the scooter first.");
    await sec.open({ user: modeUser(), pass });
    pass = "";
    cur.auth = true;
    await ctrl("get");
    if (info.mode === "claim") {
      location.hash = "#setup";
      text("teleTime", "Finish owner setup before viewing telemetry.");
      showMsg("Setup code accepted. Set a permanent passphrase to finish owner setup.", "info");
    } else {
      showMsg("Secure session ready.", "success");
      startPoll();
    }
  } catch (err) {
    pass = "";
    endAuth();
    ble.close();
    showMsg(`${errMsg(err)} Reconnect before trying again.`);
  } finally {
    busy = false;
    paint();
  }
}

async function unlock() {
  hideMsg();
  busy = true;
  paint();
  try {
    await ctrl("unlock");
    showMsg("Scooter is unlocked.", "success");
  } catch (err) {
    showMsg(errMsg(err));
  } finally {
    busy = false;
    paint();
  }
}

function holdFill(num) {
  el("lockBtn").style.setProperty("--fill", `${Math.max(0, Math.min(100, num))}%`);
  el("lockBtn").querySelector("span").textContent = num > 0 ? "Keep holding…" : "Hold to lock";
}

function stopHold() {
  holdNo += 1;
  if (hold?.raf) cancelAnimationFrame(hold.raf);
  hold = null;
  holdFill(0);
  paint();
}

async function startHold(ev) {
  if (el("lockBtn").disabled || hold) return;
  if (ev.type === "pointerdown" && ev.button !== 0) return;
  ev.preventDefault();
  hideMsg();
  const no = ++holdNo;
  const down = performance.now();
  hold = { no, down, due: down + CFG.hold, key: "", raf: 0 };
  paint();

  const tick = (now) => {
    if (!hold || hold.no !== no) return;
    holdFill(((now - hold.down) / (hold.due - hold.down)) * 100);
    if (now >= hold.due && hold.key) {
      finishHold(no);
      return;
    }
    hold.raf = requestAnimationFrame(tick);
  };
  hold.raf = requestAnimationFrame(tick);

  try {
    const rsp = await ctrl("arm");
    if (!hold || hold.no !== no) return;
    if (typeof rsp.key !== "string" || !rsp.key) {
      throw new Error("The scooter did not provide lock authorization.");
    }
    const wait = Number.isFinite(rsp.wait) ? Math.max(CFG.hold, rsp.wait) : CFG.hold;
    hold.key = rsp.key;
    hold.due = Math.max(down + CFG.hold, performance.now() + wait);
  } catch (err) {
    if (hold?.no === no) {
      stopHold();
      showMsg(errMsg(err));
    }
  }
}

async function finishHold(no) {
  if (!hold || hold.no !== no || document.hidden) {
    stopHold();
    return;
  }
  const key = hold.key;
  stopHold();
  busy = true;
  paint();
  try {
    await ctrl("lock", { key });
    showMsg("Scooter is locked.", "success");
  } catch (err) {
    showMsg(errMsg(err));
  } finally {
    busy = false;
    paint();
  }
}

async function changePass(ev) {
  ev.preventDefault();
  hideMsg();
  let one = el("newPass").value;
  let two = el("pass2").value;
  el("newPass").value = "";
  el("pass2").value = "";
  if (one !== two) {
    one = "";
    two = "";
    showMsg("The new passphrases do not match.");
    return;
  }
  if ([...one].length < 10 || [...one].length > 64) {
    one = "";
    two = "";
    showMsg("Use a passphrase containing 10 to 64 characters.");
    return;
  }
  busy = true;
  paint();
  try {
    const cred = await makeCred("owner", one);
    one = "";
    two = "";
    await newReq(cred);
    endAuth();
    ble.close();
    showMsg("Passphrase updated. Connect again with the new passphrase.", "success");
  } catch (err) {
    one = "";
    two = "";
    showMsg(errMsg(err));
  } finally {
    busy = false;
    paint();
  }
}

function num(val, digits) {
  return typeof val === "number" && Number.isFinite(val) ? val.toFixed(digits) : "—";
}

function applyTele(rsp, id) {
  checkRsp(rsp, id);
  if (!Number.isSafeInteger(rsp.seq) || rsp.seq < 0 ||
      !Number.isSafeInteger(rsp.drop) || rsp.drop < 0 ||
      !rsp.val || typeof rsp.val !== "object") {
    throw new Error("The telemetry response is invalid.");
  }
  cur.seq = rsp.seq;
  cur.drop = rsp.drop;
  cur.seen = true;
  text("speed", num(rsp.val.speed, 1));
  text("bat", num(rsp.val.bat, 0));
  text("volt", num(rsp.val.volt, 1));
  text("amps", num(rsp.val.amp, 1));
  text("power", num(rsp.val.watt, 0));
  text("temp", num(rsp.val.temp, 1));
  text("odo", num(rsp.val.odo, 1));
  if (rsp.val.fault === null || rsp.val.fault === undefined) {
    text("faults", "No verified fault data.");
  } else if (Array.isArray(rsp.val.fault)) {
    text("faults", rsp.val.fault.length ? rsp.val.fault.join(", ") : "No reported faults.");
  } else {
    text("faults", String(rsp.val.fault) || "No reported faults.");
  }
  const dropped = cur.drop ? ` • ${cur.drop} telemetry gap${cur.drop === 1 ? "" : "s"}` : "";
  text("teleTime", `Updated ${new Date().toLocaleTimeString()}${dropped}`);
  paintTele();
}

async function teleTick() {
  if (teleBusy || location.hash !== "#live" || info.mode === "claim" ||
      !cur.auth || !sec?.active || !ble.linked) return;
  teleBusy = true;
  const id = nextId();
  try {
    const req = ENC.encode(JSON.stringify({ v: 1, id, op: "get", after: cur.seq, max: 2 }));
    applyTele(parse(await call("tele", req)), id);
  } catch (err) {
    stopPoll();
    showMsg(errMsg(err));
    if (!sec?.active) {
      endAuth();
      ble.close();
    }
  } finally {
    teleBusy = false;
    if (location.hash === "#live" && cur.auth && sec?.active && ble.linked) {
      pollId = window.setTimeout(teleTick, CFG.poll);
    }
  }
}

function startPoll() {
  stopPoll();
  if (location.hash === "#live" && info.mode !== "claim" &&
      cur.auth && sec?.active && ble.linked) {
    teleTick();
  }
}

function stopPoll() {
  window.clearTimeout(pollId);
  pollId = 0;
}

function route() {
  const name = location.hash.slice(1);
  const view = VIEWS.includes(name) ? name : "control";
  for (const item of VIEWS) {
    el(item).classList.toggle("d-none", item !== view);
  }
  for (const link of document.querySelectorAll("[data-view]")) {
    const on = link.dataset.view === view;
    link.classList.toggle("active", on);
    if (on) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  }
  if (view === "live") startPoll();
  else stopPoll();
  if (view !== "control") stopHold();
}

function init() {
  const okay = BleLink.ok() && SecCli.ok();
  el("bleWarn").classList.toggle("d-none", BleLink.ok());
  el("connBtn").disabled = !okay;
  text(
    "compat",
    !BleLink.ok()
      ? "Unsupported here. Use Android Chrome and open this app over HTTPS."
      : !SecCli.ok()
        ? "This browser does not provide the required secure cryptography."
        : "Android Chrome and secure cryptography are available.",
  );

  el("connBtn").addEventListener("click", connect);
  el("discBtn").addEventListener("click", () => ble.close());
  el("authForm").addEventListener("submit", auth);
  el("logBtn").addEventListener("click", () => {
    endAuth();
    ble.close();
    showMsg("Secure session ended.", "secondary");
  });
  el("openBtn").addEventListener("click", unlock);
  el("passForm").addEventListener("submit", changePass);

  const lock = el("lockBtn");
  lock.addEventListener("pointerdown", startHold);
  lock.addEventListener("pointerleave", stopHold);
  document.addEventListener("pointerup", stopHold);
  document.addEventListener("pointercancel", stopHold);
  lock.addEventListener("keydown", (ev) => {
    if ((ev.key === " " || ev.key === "Enter") && !ev.repeat) startHold(ev);
  });
  lock.addEventListener("keyup", (ev) => {
    if (ev.key === " " || ev.key === "Enter") stopHold();
  });
  lock.addEventListener("contextmenu", (ev) => ev.preventDefault());
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) stopHold();
  });

  ble.addEventListener("bleoff", () => {
    endAuth();
    text("devName", "—");
    text("devId", "—");
    text("proto", "—");
    text("caps", "—");
    paint();
  });
  window.addEventListener("hashchange", route);
  route();
  resetTele();
  paint();

  if ("serviceWorker" in navigator && window.isSecureContext) {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  }
}

init();
