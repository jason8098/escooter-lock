import { BleLink } from "./ble.js";
import { CFG } from "./cfg.js";
import { SecCli, makeCred } from "./sec.js";

const ENC = new TextEncoder();
const DEC = new TextDecoder("utf-8", { fatal: true });
const VIEWS = ["control", "setup"];
const SAVE = { pass: "sl_pass", dev: "sl_dev", run: "sl_run" };
const ble = new BleLink();
let sec = null;
let info = {};
let rid = 0;
let txTail = Promise.resolve();
let hold = null;
let holdNo = 0;
let busy = false;

const cur = { auth: false, state: "UNKNOWN", gate: "", fault: "" };

function el(id) { return document.getElementById(id); }
function text(id, val) { el(id).textContent = val; }
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
  try { val = JSON.parse(DEC.decode(data)); }
  catch { throw new Error("The scooter returned an invalid response."); }
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
    if (!cur.auth || !sec?.active) throw new Error("Authenticate before sending a command.");
    try {
      const enc = await sec.wrap(path, plain);
      return await sec.unwrap(path, await ble.xchg(path, enc));
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
    not_ready: "The relay state is not ready for that command.",
    wait: "Keep holding the Lock button.",
    expired: "The lock hold expired. Press and hold again.",
    repeat: "That lock authorization was already used.",
    claim_only: "Finish owner setup before using scooter controls.",
    reconnect: "The passphrase changed. Reconnect to continue.",
    internal: "The scooter could not complete the command.",
    ok: "",
  };
  return list[code] || "The scooter rejected the command.";
}
function runGet() {
  const val = Number(localStorage.getItem(SAVE.run));
  return Number.isFinite(val) && val > 0 ? val : 0;
}
function runSet() {
  if (!runGet()) localStorage.setItem(SAVE.run, String(Date.now()));
}
function runClr() { localStorage.removeItem(SAVE.run); }
function runFmt(ms) {
  const sec = Math.max(0, Math.floor(ms / 1000));
  const hrs = Math.floor(sec / 3600);
  const min = Math.floor((sec % 3600) / 60);
  const rem = sec % 60;
  return [hrs, min, rem].map((val) => String(val).padStart(2, "0")).join(":");
}
function runPaint() {
  const start = runGet();
  text("runText", start ? `Run time: ${runFmt(Date.now() - start)}` : "Run time: --");
}
function applyCtl(rsp) {
  if (typeof rsp.state === "string") cur.state = rsp.state.toUpperCase();
  cur.gate = typeof rsp.gate === "string" ? rsp.gate : "";
  cur.fault = typeof rsp.fault === "string" ? rsp.fault : "";
  if (cur.state === "LOCKED") runClr();
  runPaint();
  paint();
}
function checkRsp(rsp, id) {
  if (rsp.v !== 1 || rsp.id !== id) throw new Error("The scooter response did not match this request.");
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
    const rsp = parse(await call("ctrl", req));
    checkRsp(rsp, id);
    applyCtl(rsp);
    if (!rsp.ok) throw new Error(codeMsg(rsp.gate || rsp.err));
    return rsp;
  } finally {
    req.fill(0);
    cred.salt.fill(0);
    cred.ver.fill(0);
  }
}
function setInfo(data) {
  const app = data.app;
  if (!app || typeof app !== "object") throw new Error("The scooter version response is invalid.");
  info = app;
  text("devName", ble.dev?.name || "Scooter Lock");
  text("devId", typeof app.id === "string" ? app.id : "--");
  text("proto", app.ver ? `${app.ver} (protocol ${app.proto ?? "--"})` : String(app.proto ?? "--"));
  text("caps", Array.isArray(app.cap) ? app.cap.join(", ") : "--");
  const good = app.proto === 1 && app.sec === 2 && app.sec_patch_ver === 1 &&
    ["owned", "claim"].includes(app.mode);
  if (!good) {
    text("compat", "Connected, but this firmware security version is not supported.");
    throw new Error("This scooter firmware is not compatible with the app.");
  }
  const claim = app.mode === "claim";
  el("pass").placeholder = claim ? "Enter the one-time USB setup code" : "Enter your passphrase";
  el("savePass").disabled = claim;
  if (claim) {
    el("savePass").checked = false;
    text("authText", "Use the one-time setup code shown over USB, then set a permanent passphrase.");
  } else {
    text("authText", "Saved passphrases are stored only in this browser on this phone.");
  }
  text("compat", "Compatible secure firmware detected.");
}
function stateName() {
  const list = { LOCKED: "Locked", READY: "Unlocked", FAULT: "Lock fault", UNKNOWN: "State unknown" };
  return list[cur.state] || "State unknown";
}
function gateMsg(auth) {
  if (!auth) return "Locking is available after authentication.";
  if (info.mode === "claim") return "Finish owner setup before using scooter controls.";
  if (cur.state === "FAULT") return cur.fault || "The SSR control state is unavailable.";
  if (cur.state === "LOCKED") return "Scooter is already locked.";
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
  el("savePass").disabled = !linked || auth || busy || info.mode === "claim";
  el("authBtn").disabled = !linked || !sec || auth || busy;
  el("logBtn").classList.toggle("d-none", !auth);
  el("logBtn").disabled = busy;
  const ring = el("stateRing");
  ring.className = `state-ring ${auth ? cur.state.toLowerCase() : "unknown"} mx-auto mb-3`;
  text("stateIcon", !auth ? "?" : cur.state === "LOCKED" ? "L" : cur.state === "READY" ? "U" : cur.state === "FAULT" ? "!" : "?");
  text("lockText", auth ? stateName() : "State unknown");
  text("dispText", auth ? "SSR control output state read from the ESP." : linked ? "Authenticate to read the SSR control state." : "Connect and authenticate to read the SSR control state.");
  el("openBtn").disabled = !auth || claim || busy || held || cur.state === "READY" || cur.state === "FAULT";
  el("lockBtn").disabled = !auth || claim || busy || held || cur.state !== "READY";
  text("gateText", gateMsg(auth));
  for (const id of ["newPass", "pass2", "passBtn"]) el(id).disabled = !auth || busy || held;
  runPaint();
}
function holdFill(num) {
  const val = Math.max(0, Math.min(100, num));
  el("lockBtn").style.setProperty("--fill", `${val}%`);
  el("lockBtn").querySelector("span").textContent = val > 0 ? "Keep holding" : "Hold to lock";
}
function stopHold() {
  holdNo += 1;
  if (hold?.raf) cancelAnimationFrame(hold.raf);
  hold = null;
  holdFill(0);
  paint();
}
function endAuth() {
  stopHold();
  sec?.close();
  sec = null;
  cur.auth = false;
  cur.state = "UNKNOWN";
  cur.gate = "";
  cur.fault = "";
  txTail = Promise.resolve();
  el("pass").value = "";
  el("newPass").value = "";
  el("pass2").value = "";
  paint();
}
async function conn(auto = false) {
  hideMsg();
  busy = true;
  paint();
  try {
    if (auto) await ble.resume(localStorage.getItem(SAVE.dev));
    else await ble.open();
    if (ble.dev?.id) localStorage.setItem(SAVE.dev, ble.dev.id);
    setInfo(parse(await ble.readVer()));
    sec = new SecCli({ send: (data) => ble.xchg("sec", data) });
    return true;
  } catch (err) {
    ble.close();
    if (!auto) showMsg(errMsg(err));
    return false;
  } finally {
    busy = false;
    paint();
  }
}
async function login(pass, auto = false) {
  busy = true;
  paint();
  try {
    if (!sec) throw new Error("Connect to the scooter first.");
    await sec.open({ user: "owner", pass });
    cur.auth = true;
    await ctrl("get");
    if (info.mode === "claim") {
      location.hash = "#setup";
      showMsg("Setup code accepted. Set a permanent passphrase to finish owner setup.", "info");
    } else if (!auto) {
      showMsg("Secure session ready.", "success");
    }
    return true;
  } catch (err) {
    endAuth();
    ble.close();
    if (!auto) showMsg(`${errMsg(err)} Reconnect before trying again.`);
    return false;
  } finally {
    busy = false;
    paint();
  }
}
async function auth(ev) {
  ev.preventDefault();
  hideMsg();
  const pass = el("pass").value;
  el("pass").value = "";
  if (!await login(pass)) return;
  if (info.mode !== "claim" && el("savePass").checked) localStorage.setItem(SAVE.pass, pass);
  else localStorage.removeItem(SAVE.pass);
}
async function unlock() {
  hideMsg();
  busy = true;
  paint();
  try {
    await ctrl("unlock");
    runSet();
    runPaint();
    showMsg("Scooter is unlocked.", "success");
  } catch (err) {
    showMsg(errMsg(err));
  } finally {
    busy = false;
    paint();
  }
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
      finish(no);
      return;
    }
    hold.raf = requestAnimationFrame(tick);
  };
  hold.raf = requestAnimationFrame(tick);
  try {
    const rsp = await ctrl("arm");
    if (!hold || hold.no !== no) return;
    if (typeof rsp.key !== "string" || !rsp.key) throw new Error("The scooter did not provide lock authorization.");
    hold.key = rsp.key;
    hold.due = Math.max(down + CFG.hold, performance.now() + (Number(rsp.wait) || CFG.hold));
  } catch (err) {
    if (hold?.no === no) {
      stopHold();
      showMsg(errMsg(err));
    }
  }
}
async function finish(no) {
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
    runClr();
    runPaint();
    showMsg("Scooter is locked.", "success");
  } catch (err) {
    showMsg(errMsg(err));
  } finally {
    busy = false;
    paint();
  }
}
async function chgPass(ev) {
  ev.preventDefault();
  hideMsg();
  let one = el("newPass").value;
  const two = el("pass2").value;
  el("newPass").value = "";
  el("pass2").value = "";
  if (one !== two) {
    showMsg("The new passphrases do not match.");
    return;
  }
  if ([...one].length < 10 || [...one].length > 64) {
    showMsg("Use a passphrase containing 10 to 64 characters.");
    return;
  }
  busy = true;
  paint();
  try {
    const cred = await makeCred("owner", one);
    await newReq(cred);
    if (el("savePass").checked) localStorage.setItem(SAVE.pass, one);
    one = "";
    endAuth();
    ble.close();
    showMsg("Passphrase updated. Connect again with the new passphrase.", "success");
  } catch (err) {
    one = "";
    showMsg(errMsg(err));
  } finally {
    busy = false;
    paint();
  }
}
function route() {
  const name = location.hash.slice(1);
  const view = VIEWS.includes(name) ? name : "control";
  for (const item of VIEWS) el(item).classList.toggle("d-none", item !== view);
  for (const link of document.querySelectorAll("[data-view]")) {
    const on = link.dataset.view === view;
    link.classList.toggle("active", on);
    if (on) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  }
  if (view !== "control") stopHold();
}
async function autoLink() {
  const pass = localStorage.getItem(SAVE.pass);
  if (!pass || !BleLink.ok() || !SecCli.ok()) return;
  if (await conn(true)) await login(pass, true);
}
function init() {
  const okay = BleLink.ok() && SecCli.ok();
  el("bleWarn").classList.toggle("d-none", BleLink.ok());
  el("connBtn").disabled = !okay;
  el("savePass").checked = Boolean(localStorage.getItem(SAVE.pass));
  text("compat", !BleLink.ok() ? "Unsupported here. Use Android Chrome with a secure browser origin." : !SecCli.ok() ? "This browser does not provide the required secure cryptography." : "Android Chrome and secure cryptography are available.");
  el("connBtn").addEventListener("click", () => conn());
  el("discBtn").addEventListener("click", () => ble.close());
  el("authForm").addEventListener("submit", auth);
  el("logBtn").addEventListener("click", () => {
    endAuth();
    ble.close();
    showMsg("Secure session ended. Relay state was not changed.", "secondary");
  });
  el("openBtn").addEventListener("click", unlock);
  el("passForm").addEventListener("submit", chgPass);
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
    text("devName", "--");
    text("devId", "--");
    text("proto", "--");
    text("caps", "--");
    paint();
  });
  window.addEventListener("hashchange", route);
  route();
  runPaint();
  window.setInterval(runPaint, 1000);
  paint();
  autoLink();
  if ("serviceWorker" in navigator && window.isSecureContext) {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  }
}
init();
