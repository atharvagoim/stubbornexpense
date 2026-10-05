require("dotenv").config();

const path = require("path");
const crypto = require("crypto");
const express = require("express");
const cookieParser = require("cookie-parser");
const jwt = require("jsonwebtoken");
const rateLimit = require("express-rate-limit");
const compression = require("compression");
const createStore = require("./store");
const { parseNote } = require("./ai");
const { pubUser } = createStore;

const PORT = process.env.PORT || 3000;
const IS_PROD = process.env.NODE_ENV === "production";
let JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET || JWT_SECRET.length < 32) {
  if (IS_PROD || process.env.VERCEL) {
    // a random key per server instance would log people out at random, and a short key is guessable
    throw new Error("JWT_SECRET must be set to a long random string (32+ characters) in production.");
  }
  JWT_SECRET = crypto.randomBytes(32).toString("hex");
  console.warn("⚠  JWT_SECRET not set — using a temporary one (everyone is logged out when the server restarts).");
}
if (process.env.VERCEL && !process.env.MONGODB_URI) console.error("✗ MONGODB_URI is required on Vercel.");

const store = createStore();
const ready = store.init();
const app = express();
// wrap every async route handler so a rejected promise becomes a clean 500 instead of crashing the process
for (const m of ["get", "post", "patch", "put", "delete"]) {
  const orig = app[m].bind(app);
  app[m] = (path, ...fns) => (typeof path === "string" && fns.length
    ? orig(path, ...fns.map((fn) => (fn.length >= 4 ? fn : (req, res, next) => { try { const p = fn(req, res, next); if (p && p.catch) p.catch(next); } catch (e) { next(e); } })))
    : orig(path, ...fns));
}
app.set("trust proxy", 1);
app.use(compression()); // smaller responses (HTML, CSS, JS, JSON)
app.disable("x-powered-by");

/* ---------- security headers ---------- */
const CSP = [
  "default-src 'self'", "script-src 'self'", "style-src 'self' 'unsafe-inline'", "img-src 'self' data: blob:",
  "font-src 'self'", "connect-src 'self'", "object-src 'none'", "base-uri 'self'", "form-action 'self'", "frame-ancestors 'none'",
  ...(IS_PROD ? ["upgrade-insecure-requests"] : []),
].join("; ");
app.use((req, res, next) => {
  res.setHeader("Content-Security-Policy", CSP);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(self), geolocation=(), payment=()");
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  if (IS_PROD) res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  next();
});
app.use((req, res, next) => ready.then(() => next(), next));
app.use((req, res, next) => (req.method === "PATCH" && req.path === "/api/me"
  ? express.json({ limit: "300kb" })(req, res, next)   // room for a small profile photo
  : express.json({ limit: "16kb" })(req, res, next)));
app.use(cookieParser());

/* ---------- API basics: no caching, same-site only for changes ---------- */
app.use("/api", (req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  if (["GET", "HEAD"].includes(req.method)) return next();
  const site = req.get("Sec-Fetch-Site");
  if (site && !["same-origin", "none"].includes(site)) return res.status(403).json({ error: "Blocked." });
  const origin = req.get("Origin");
  if (origin) { let h = ""; try { h = new URL(origin).host; } catch {} if (h !== req.get("host")) return res.status(403).json({ error: "Blocked." }); }
  next();
});
app.param("id", (req, res, next, id) => (/^[A-Za-z0-9-]{1,64}$/.test(id) ? next() : res.status(404).json({ error: "Not found." })));

const limiter = (limit, minutes, error) => rateLimit({ windowMs: minutes * 60000, limit, standardHeaders: "draft-7", legacyHeaders: false, message: { error } });
const authLimiter = limiter(15, 15, "Too many attempts. Try again in a few minutes.");
const writeLimiter = limiter(240, 10, "Slow down a little.");

/* ---------- passwords + sessions ---------- */
const hashPassword = (pw) => new Promise((resolve, reject) => {
  const salt = crypto.randomBytes(16);
  crypto.scrypt(pw, salt, 64, { N: 16384, r: 8, p: 1 }, (err, key) => (err ? reject(err) : resolve(`s1$${salt.toString("hex")}$${key.toString("hex")}`)));
});
const checkPassword = (pw, stored) => new Promise((resolve) => {
  const [, saltHex, keyHex] = String(stored || "").split("$");
  if (!saltHex || !keyHex) return resolve(false);
  crypto.scrypt(pw, Buffer.from(saltHex, "hex"), 64, { N: 16384, r: 8, p: 1 }, (err, key) =>
    resolve(!err && crypto.timingSafeEqual(key, Buffer.from(keyHex, "hex"))));
});
const DUMMY_HASH = "s1$" + "0".repeat(32) + "$" + "0".repeat(128);

const COOKIE = "sid";
const cookieOpts = { httpOnly: true, sameSite: "lax", secure: IS_PROD, path: "/", maxAge: 30 * 24 * 3600 * 1000 };
const cookieFor = (req) => ({ ...cookieOpts, secure: IS_PROD || req.secure });
// the session is tied to the password, so changing it signs out other devices
const pv = (u) => crypto.createHash("sha256").update(String(u.passHash)).digest("hex").slice(0, 12);
const signIn = (req, res, u) => res.cookie(COOKIE, jwt.sign({ sub: u.id, pv: pv(u) }, JWT_SECRET, { algorithm: "HS256", expiresIn: "30d" }), cookieFor(req));

async function auth(req, res, next) {
  try {
    const p = jwt.verify(req.cookies[COOKIE] || "", JWT_SECRET, { algorithms: ["HS256"] });
    const u = await store.getUser(p.sub);
    if (!u || p.pv !== pv(u)) throw new Error("bad session");
    req.user = u;
    next();
  } catch {
    res.status(401).json({ error: "Please log in." });
  }
}

/* ---------- validation ---------- */
const str = (v, max) => (typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e]/g, "").trim().slice(0, max) : "");
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const USERNAME = /^[a-z0-9._]{3,20}$/;
function cleanProfile(b, { partial = false } = {}) {
  const out = {}, errors = {};
  if (!partial || "name" in b) { out.name = str(b.name, 50); if (!out.name) errors.name = "Enter your full name"; }
  if (!partial || "username" in b) {
    out.username = str(b.username, 30).toLowerCase().replace(/^@/, "");
    if (!USERNAME.test(out.username)) errors.username = "3–20 letters, numbers, . or _";
  }
  if (!partial || "email" in b) { out.email = str(b.email, 120).toLowerCase(); if (!EMAIL.test(out.email)) errors.email = "Enter a valid email"; }
  return { out, errors };
}

const COMMON = new Set(["password", "password1", "password123", "12345678", "123456789", "1234567890", "11111111", "00000000", "qwertyui", "qwerty123", "iloveyou", "abcdefgh", "abc12345", "letmein1", "welcome1", "admin123", "11223344", "87654321", "passw0rd", "asdfghjk"]);
function passwordProblem(pw, { username = "", email = "" } = {}) {
  if (pw.length < 8) return "Use at least 8 characters.";
  if (pw.length > 200) return "That password is too long.";
  const low = pw.toLowerCase();
  if (COMMON.has(low) || /^(.)\1+$/.test(pw)) return "That password is too easy to guess. Try another.";
  if ((username && low.includes(username)) || (email && low === email)) return "Don't use your username or email as your password.";
  return "";
}

/* ---------- slow down password guessing on one account (on top of the per-IP limit) ---------- */
const failures = new Map(); // login → { n, until }
function lockedFor(key) { const f = failures.get(key); return f && f.until > Date.now() ? Math.ceil((f.until - Date.now()) / 60000) : 0; }
function noteFailure(key) {
  const f = failures.get(key) || { n: 0, until: 0 };
  f.n += 1;
  if (f.n >= 8) { f.until = Date.now() + 15 * 60000; f.n = 0; }
  failures.set(key, f);
  if (failures.size > 50000) failures.clear();
}

/* ---------- auth routes ---------- */
app.post("/api/signup", authLimiter, async (req, res) => {
  const b = req.body || {};
  const { out, errors } = cleanProfile(b);
  const password = typeof b.password === "string" ? b.password : "";
  const pwErr = passwordProblem(password, out); if (pwErr) errors.password = pwErr;
  if (Object.keys(errors).length) return res.status(400).json({ error: "Please check the highlighted fields.", fields: errors });
  const clash = await store.taken(out);
  if (clash) return res.status(409).json({ error: `That ${clash} is already taken.`, fields: { [clash]: `This ${clash} is already in use` } });
  const u = await store.createUser({ ...out, passHash: await hashPassword(password), avatar: "" });
  signIn(req, res, u).status(201).json(pubUser(u));
});

// Sign-up steps: is this username / email still free?
const checkLimiter = limiter(60, 10, "Too many checks. Wait a moment.");
app.get("/api/check", checkLimiter, async (req, res) => {
  const out = {};
  if (typeof req.query.username === "string") {
    const u = req.query.username.trim().toLowerCase().replace(/^@/, "").slice(0, 30);
    out.username = !USERNAME.test(u) ? "invalid" : (await store.taken({ username: u, email: "\u0000" })) ? "taken" : "ok";
  }
  if (typeof req.query.email === "string") {
    const e = req.query.email.trim().toLowerCase().slice(0, 120);
    out.email = !EMAIL.test(e) ? "invalid" : (await store.taken({ username: "\u0000", email: e })) ? "taken" : "ok";
  }
  res.json(out);
});

app.post("/api/login", authLimiter, async (req, res) => {
  const b = req.body || {};
  const login = str(b.login, 120).replace(/^@/, "");
  const password = typeof b.password === "string" ? b.password.slice(0, 200) : "";
  const key = login.toLowerCase();
  const wait = lockedFor(key);
  if (wait) return res.status(429).json({ error: `Too many wrong passwords. Try again in ${wait} min.` });
  const u = login ? await store.findUserByLogin(login) : null;
  const good = await checkPassword(password, u ? u.passHash : DUMMY_HASH); // same timing whether or not the user exists
  if (!u || !good) { noteFailure(key); return res.status(401).json({ error: "Wrong username/email or password." }); }
  failures.delete(key); signIn(req, res, u).json(pubUser(u));
});

app.post("/api/logout", (req, res) => res.clearCookie(COOKIE, { ...cookieFor(req), maxAge: undefined }).json({ ok: true }));
app.get("/api/me", auth, (req, res) => res.json(pubUser(req.user)));

app.patch("/api/me", auth, writeLimiter, async (req, res) => {
  const b = req.body || {};
  const { out, errors } = cleanProfile(b, { partial: true });
  delete out.email; delete errors.email; // email is not editable after signup
  if ("avatar" in b) {
    const a = typeof b.avatar === "string" ? b.avatar : "";
    if (a && !(/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(a) && a.length < 280000)) errors.avatar = "Use a JPG, PNG or WebP photo";
    out.avatar = a;
  }
  if (Object.keys(errors).length) return res.status(400).json({ error: Object.values(errors)[0], fields: errors });
  if (out.username || out.email) {
    const clash = await store.taken({ username: out.username || req.user.username, email: out.email || req.user.email }, req.user.id);
    if (clash) return res.status(409).json({ error: `That ${clash} is already taken.`, fields: { [clash]: "Already in use" } });
  }
  res.json(pubUser(await store.updateUser(req.user.id, out)));
});

// Delete account: only with the right password. Removes the user and all their entries.
app.delete("/api/me", authLimiter, auth, async (req, res) => {
  const password = typeof (req.body || {}).password === "string" ? req.body.password.slice(0, 200) : "";
  if (!password || !(await checkPassword(password, req.user.passHash))) return res.status(401).json({ error: "Wrong password.", field: "password" });
  await store.removeUser(req.user.id);
  res.clearCookie(COOKIE, { ...cookieFor(req), maxAge: undefined }).json({ ok: true });
});

/* ---------- money ---------- */
const CATS = {
  debit: ["Travel", "Food", "Fuel", "Coke", "Shopping", "Alcohol", "Bills", "Maintenance", "Groceries"],
  credit: ["Salary", "Allowance"],
};
app.get("/api/transactions", auth, async (req, res) => res.json(await store.listTx(req.user.id)));

app.post("/api/transactions", auth, writeLimiter, async (req, res) => {
  const b = req.body || {};
  const type = b.type === "credit" ? "credit" : b.type === "debit" ? "debit" : "";
  const amount = Math.round(Number(b.amount) * 100) / 100;
  let category = str(b.category, 30);
  const custom = b.custom === true;
  if (!type) return res.status(400).json({ error: "Pick credit or debit." });
  if (!Number.isFinite(amount) || amount <= 0 || amount > 1e9) return res.status(400).json({ error: "Enter an amount above 0.", field: "amount" });
  if (custom) { if (!category) return res.status(400).json({ error: "Type a name for your custom category.", field: "category" }); }
  else if (!CATS[type].includes(category)) return res.status(400).json({ error: "Pick a category.", field: "category" });
  if ((await store.countTx(req.user.id)) >= 20000) return res.status(400).json({ error: "You've reached the maximum number of entries." });
  res.status(201).json(await store.addTx(req.user.id, { type, amount, category, note: custom ? "custom" : "" }));
});

app.delete("/api/transactions/:id", auth, writeLimiter, async (req, res) => {
  (await store.removeTx(req.user.id, req.params.id)) ? res.json({ ok: true }) : res.status(404).json({ error: "Not found." });
});

// AI: "spent 250 on uber and got 5000 salary" → entries, added straight away (the app offers Undo)
const aiLimiter = limiter(40, 10, "You're using voice/AI entry a lot. Wait a few minutes.");
app.post("/api/ai/parse", auth, aiLimiter, async (req, res) => {
  const text = str((req.body || {}).text, 300);
  if (!text) return res.status(400).json({ error: "Say or type what you spent or received." });
  const { items, engine } = await parseNote(text);
  if (!items.length) return res.status(422).json({ error: "I couldn't find an amount. Try: \"spent 200 on food\"." });
  if ((await store.countTx(req.user.id)) + items.length > 20000) return res.status(400).json({ error: "You've reached the maximum number of entries." });
  const added = [];
  for (const it of items) added.push(await store.addTx(req.user.id, { type: it.type, amount: it.amount, category: it.category, note: it.custom ? "custom" : "ai" }));
  res.status(201).json({ added, engine });
});

app.get("/api/health", (req, res) => res.json({ ok: true, storage: store.kind, ai: process.env.ANTHROPIC_API_KEY ? "claude" : "offline" }));
app.use("/api", (req, res) => res.status(404).json({ error: "Not found." }));

/* ---------- the app ---------- */
const PUBLIC = path.join(__dirname, "..", "public");
app.use(express.static(PUBLIC, {
  dotfiles: "ignore",
  setHeaders(res, f) { res.setHeader("Cache-Control", /\.(png|jpe?g|woff2|svg)$/.test(f) ? "public, max-age=604800" : "no-cache"); },
}));
app.use((req, res) => res.sendFile(path.join(PUBLIC, "index.html")));

// errors: bad JSON → 400, too large → 413, anything else → generic 500 (details only in the server log)
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  if (err.type === "entity.parse.failed") return res.status(400).json({ error: "Bad request." });
  if (err.type === "entity.too.large") return res.status(413).json({ error: "That's too large." });
  console.error(err);
  res.status(500).json({ error: "Something went wrong. Please try again." });
});

if (require.main === module) {
  ready.then(() => app.listen(PORT, () => {
    console.log(`✓ App: http://localhost:${PORT}`);
    console.log(`✓ Storage: ${store.kind === "mongodb" ? "MongoDB" : "local file (data/db.json)"}`);
  })).catch((e) => { console.error("Could not connect to the database:", e.message); process.exit(1); });
}
module.exports = app;
