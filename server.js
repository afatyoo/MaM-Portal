import express from "express";
import fs from "fs";
import path from "path";
import ini from "ini";
import crypto from "crypto";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import session from "express-session";
import FileStoreFactory from "session-file-store";
import bcrypt from "bcryptjs";
import { Agent } from "undici";
import http from "http";
import https from "https";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const LOG_FILE = process.env.LOG_FILE || path.join(DATA_DIR, "login_attempts.jsonl");
const ADMIN_FILE = process.env.ADMIN_FILE || path.join(DATA_DIR, "admin_users.json");

// Default admin (untuk dev). Bisa dioverride via ENV.
const DEFAULT_ADMIN_USER = process.env.DEFAULT_ADMIN_USER || "admin";
const DEFAULT_ADMIN_PASS = process.env.DEFAULT_ADMIN_PASS || "admin";

function ensureDataFiles() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(LOG_FILE)) fs.writeFileSync(LOG_FILE, "", "utf8");
  if (!fs.existsSync(ADMIN_FILE)) fs.writeFileSync(ADMIN_FILE, JSON.stringify({ users: [] }, null, 2), "utf8");
}
ensureDataFiles();

async function ensureDefaultAdminExists() {
  const db = readAdminDb(ADMIN_FILE);
  if (db.users.some(u => u.username === DEFAULT_ADMIN_USER)) return;

  db.users.push({
    username: DEFAULT_ADMIN_USER,
    password_hash: await bcrypt.hash(String(DEFAULT_ADMIN_PASS), 12),
    created_at: new Date().toISOString()
  });
  writeAdminDb(ADMIN_FILE, db);
  console.log("⚠️  Default admin ensured:", DEFAULT_ADMIN_USER, "/", DEFAULT_ADMIN_PASS);
  console.log("    (Set env DEFAULT_ADMIN_USER/DEFAULT_ADMIN_PASS untuk ganti, terutama jika production)");
}

function getConfigPath() {
  return process.env.CONFIG_PATH || path.join(__dirname, "config.ini");
}

function readIniConfig() {
  const cfgPath = getConfigPath();
  if (!fs.existsSync(cfgPath)) throw new Error(`config.ini tidak ditemukan di ${cfgPath}. Copy config.sample.ini -> config.ini`);
  const text = fs.readFileSync(cfgPath, "utf-8");
  const obj = ini.parse(text);
  return { cfgPath, obj };
}

function writeIniConfig(cfgPath, obj) {
  // NOTE: ini.stringify tidak menjaga komentar/format. Ini trade-off demi mudah dimaintain via admin UI.
  const out = ini.stringify(obj);
  fs.writeFileSync(cfgPath, out, "utf-8");
}

function loadConfig() {
  const cfgPath = getConfigPath();
  if (!fs.existsSync(cfgPath)) throw new Error(`config.ini tidak ditemukan di ${cfgPath}. Copy config.sample.ini -> config.ini`);
  const cfg = ini.parse(fs.readFileSync(cfgPath, "utf-8"));

  const defaultDomain = (cfg.DEFAULT?.default_domain || "").trim();

  const web = cfg.WEB || {};
  const httpsEnabled = String(process.env.HTTPS_ENABLED || web.https_enabled || "false").toLowerCase() === "true";
  const httpPort = Number(process.env.PORT || web.http_port || 8080);
  const httpsPort = Number(process.env.HTTPS_PORT || web.https_port || 8443);
  const tlsKeyFile = process.env.TLS_KEY_FILE || web.tls_key_file || path.join(__dirname, "certs/server.key");
  const tlsCertFile = process.env.TLS_CERT_FILE || web.tls_cert_file || path.join(__dirname, "certs/server.crt");

  const admin = cfg.ADMIN || {};
  const adminSessionSecret = process.env.ADMIN_SESSION_SECRET || admin.session_secret || "CHANGE_ME_SESSION_SECRET";
  const adminBasePath = (admin.base_path || "/admin").trim().replace(/\/+$/, "") || "/admin";

  const servers = Object.keys(cfg)
    .filter(k => k.startsWith("MaMKey_"))
    .map((key) => {
      const s = cfg[key] || {};
      const domains = (s.domains || "").split(",").map(d => d.trim().toLowerCase()).filter(Boolean);
      return {
        key,
        name: s.name || key,
        server: (s.server || "").replace(/\/+$/, ""),
        domains,
        preauthkey: (s.preauthkey || "").trim(),
        soapPath: (s.soap_path || "/service/soap").trim(),
        preauthPath: (s.preauth_path || "/service/preauth").trim(),
        caFile: (s.ca_file || "").trim(),
        insecureTls: String(s.insecure_tls || "false").toLowerCase() === "true",
      };
    })
    .filter(s => s.server && s.preauthkey && s.domains.length > 0);

  return { defaultDomain, servers, httpsEnabled, httpPort, httpsPort, tlsKeyFile, tlsCertFile, adminSessionSecret, adminBasePath };
}

function parseDomains(domainsStr) {
  return String(domainsStr || "")
    .split(",")
    .map(s => s.trim().toLowerCase())
    .filter(Boolean);
}

function maskKey(k) {
  const s = String(k || "");
  if (!s) return "";
  if (s.length <= 6) return "******";
  return s.slice(0, 3) + "..." + s.slice(-3);
}

function normalizeEmail(username, defaultDomain) {
  const u = String(username || "").trim();
  if (!u) return "";
  if (u.includes("@")) return u;
  return defaultDomain ? `${u}@${defaultDomain}` : u;
}

function findCandidates(servers, domain) {
  const d = (domain || "").toLowerCase();
  return [
    ...servers.filter(s => s.domains.includes(d)),
    ...servers.filter(s => s.domains.includes("*"))
  ];
}

function computePreauth({ account, by="name", expires="0", timestamp }, key) {
  const authstr = `${account}|${by}|${expires}|${timestamp}`;
  return crypto.createHmac("sha1", Buffer.from(key, "utf8")).update(authstr, "utf8").digest("hex");
}

function escapeXml(s) {
  return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&apos;");
}

function readAdminDb(file) {
  const j = JSON.parse(fs.readFileSync(file, "utf8"));
  j.users = j.users || [];
  return j;
}
function writeAdminDb(file, db) { fs.writeFileSync(file, JSON.stringify(db, null, 2), "utf8"); }

function appendJsonl(file, obj) { fs.appendFileSync(file, JSON.stringify(obj) + "\n", "utf8"); }

function tailJsonl(file, limit=200) {
  if (!fs.existsSync(file)) return [];
  const text = fs.readFileSync(file, "utf8").trim();
  if (!text) return [];
  const lines = text.split("\n").filter(Boolean);
  return lines.slice(-limit).map(l => { try { return JSON.parse(l);} catch { return null; } }).filter(Boolean).reverse();
}

function computeStats(entries) {
  const total = entries.length;
  const ok = entries.filter(e => e.result==="ok").length;
  const fail = total - ok;

  const byServer = {};
  const byDomain = {};
  for (const e of entries) {
    byServer[e.server_key || "unknown"] = (byServer[e.server_key || "unknown"] || 0) + 1;
    byDomain[e.domain || "unknown"] = (byDomain[e.domain || "unknown"] || 0) + 1;
  }

  const now = Date.now();
  const last24 = entries.filter(e => (now - Date.parse(e.timestamp)) <= 24*3600*1000);
  const last24_total = last24.length;
  const last24_ok = last24.filter(e => e.result==="ok").length;

  return {
    total, ok, fail,
    last24_total,
    last24_ok,
    last24_fail: last24_total - last24_ok,
    byServer, byDomain
  };
}

function makeDispatcher({ caFile, insecureTls }) {
  const connect = {};
  if (caFile) {
    const caPath = path.isAbsolute(caFile) ? caFile : path.join(__dirname, caFile);
    connect.ca = fs.readFileSync(caPath);
  }
  if (insecureTls) {
    // Per-request (lebih aman dibanding set env global)
    connect.rejectUnauthorized = false;
  }
  if (Object.keys(connect).length === 0) return undefined;
  return new Agent({ connect });
}

async function soapAuth({ server, soapPath, account, password, caFile, insecureTls }) {
  const url = server + soapPath;
  const body = `<?xml version="1.0" encoding="UTF-8"?>` +
    `<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope">` +
    `<soap:Header><context xmlns="urn:zimbra"><format type="xml"/></context></soap:Header>` +
    `<soap:Body><AuthRequest xmlns="urn:zimbraAccount">` +
    `<account by="name">${escapeXml(account)}</account>` +
    `<password>${escapeXml(password)}</password>` +
    `</AuthRequest></soap:Body></soap:Envelope>`;

  const dispatcher = makeDispatcher({ caFile, insecureTls });

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": 'application/soap+xml; charset="utf-8"', "Accept": "application/soap+xml, text/xml" },
    body,
    dispatcher
  });
  const text = await res.text();
  const ok = res.ok && /<authToken>[^<]+<\/authToken>/i.test(text);
  return { ok, status: res.status, text };
}

const app = express();
app.disable("x-powered-by");
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cookieParser());
app.use(express.json({ limit: "100kb" }));
app.use(express.urlencoded({ extended: true }));

const FileStore = FileStoreFactory(session);
const cfg0 = loadConfig();

app.use(session({
  store: new FileStore({ path: path.join(DATA_DIR, "sessions") }),
  secret: cfg0.adminSessionSecret,
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: "lax", secure: cfg0.httpsEnabled, maxAge: 8*60*60*1000 }
}));

app.use("/", express.static(path.join(__dirname, "public"), { extensions: ["html"] }));

// Convenience: beberapa orang kebiasaan buka /login
app.get("/login", (req, res) => res.redirect("/"));

// Pastikan /admin tanpa trailing slash tetap nyambung
app.get(cfg0.adminBasePath, (req, res) => res.redirect(cfg0.adminBasePath + "/"));

app.get("/api/health", (req,res)=>res.json({status:"ok", timestamp:new Date().toISOString()}));
app.get("/api/servers", (req,res)=>{
  const {servers} = loadConfig();
  res.json({ servers: servers.map(s=>({key:s.key,name:s.name,server:s.server,domains:s.domains}))});
});

app.post("/api/login", async (req,res)=>{
  const started = Date.now();
  const base = {
    timestamp: new Date().toISOString(),
    method: "password",
    ip: req.ip,
    ua: req.headers["user-agent"] || ""
  };

  const logOk = (payload) => appendJsonl(LOG_FILE, { ...base, ...payload, result: "ok", ms: Date.now() - started });
  const logFail = (payload) => appendJsonl(LOG_FILE, { ...base, ...payload, result: "fail", ms: Date.now() - started });

  try{
    const {defaultDomain, servers} = loadConfig();
    const username = req.body.username ?? req.body.email ?? "";
    const password = req.body.password ?? "";

    const email = normalizeEmail(username, defaultDomain);
    const domain = (email.split("@")[1] || "").toLowerCase();

    if(!email || !password){
      logFail({ email, domain, server_key: "", reason: "missing_credentials" });
      return res.status(400).json({error:"username/password wajib diisi"});
    }
    if(!domain){
      logFail({ email, domain: "", server_key: "", reason: "invalid_email" });
      return res.status(400).json({error:"format email tidak valid"});
    }

    const forcedKey = (req.body.server_key || "").trim();
    let candidates = findCandidates(servers, domain);

    if(forcedKey){
      const forced = servers.find(s=>s.key===forcedKey);
      if(!forced){
        logFail({ email, domain, server_key: forcedKey, reason: "unknown_server_key" });
        return res.status(400).json({error:`server_key ${forcedKey} tidak dikenal`});
      }
      candidates = [forced];
    }

    if(!candidates.length){
      logFail({ email, domain, server_key: "", reason: "domain_unmapped" });
      return res.status(400).json({error:`Domain ${domain} belum dipetakan ke Server manapun`});
    }

    const attempted = [];
    let lastErr = "";

    for(const s of candidates){
      attempted.push(s.key);

      let auth;
      try{
        auth = await soapAuth({server:s.server, soapPath:s.soapPath, account:email, password, caFile:s.caFile, insecureTls:s.insecureTls});
      }catch(err){
        lastErr = String(err?.message || err || "").slice(0, 200);
        logFail({ email, domain, server_key: s.key, reason: "soap_error", error: lastErr });
        continue;
      }

      if(auth.ok){
        const ts = Date.now().toString();
        const expires = "0";
        const by="name";
        const preauth = computePreauth({account:email,by,expires,timestamp:ts}, s.preauthkey);

        const redirectUrl =
          `${s.server}${s.preauthPath}` +
          `?account=${encodeURIComponent(email)}` +
          `&by=${encodeURIComponent(by)}` +
          `&expires=${encodeURIComponent(expires)}` +
          `&timestamp=${encodeURIComponent(ts)}` +
          `&preauth=${encodeURIComponent(preauth)}`;

        logOk({ email, domain, server_key: s.key, attempted });
        return res.json({redirectUrl, server:s.key});
      }
    }

    logFail({ email, domain, server_key: candidates[0]?.key || "unknown", attempted, reason: "auth_failed", error: lastErr });
    return res.status(401).json({error:"Login gagal (user/pass salah atau server tidak bisa diakses)"});
  }catch(e){
    const msg = String(e?.message || e || "").slice(0, 200);
    logFail({ email: req.body?.username || "", domain: "", server_key: "", reason: "internal_error", error: msg });
    console.error(e);
    return res.status(500).json({error:"Internal error"});
  }
});

app.delete("/api/admin/users/:username", requireAdmin, (req,res)=>{
  const target = String(req.params.username || "").trim();
  if(!target) return res.status(400).json({error:"username wajib diisi"});

  // safety: jangan hapus user yang sedang login
  const current = req.session?.admin?.username;
  if(current && target === current) {
    return res.status(400).json({error:"Tidak bisa menghapus user yang sedang login"});
  }

  const db = readAdminDb(ADMIN_FILE);
  if(!db.users || db.users.length === 0) return res.status(404).json({error:"User tidak ditemukan"});

  // safety: jangan biarkan 0 admin
  if(db.users.length <= 1) {
    return res.status(400).json({error:"Tidak bisa menghapus admin terakhir"});
  }

  const idx = db.users.findIndex(u => u.username === target);
  if(idx === -1) return res.status(404).json({error:"User tidak ditemukan"});

  db.users.splice(idx, 1);
  writeAdminDb(ADMIN_FILE, db);
  return res.json({ok:true});
});



function requireAdmin(req,res,next){
  if(req.session?.admin?.username) return next();
  return res.status(401).json({error:"Unauthorized"});
}

function maskSecret(s){
  if(!s) return "";
  const str = String(s);
  if(str.length <= 6) return "******";
  return str.slice(0,2) + "***" + str.slice(-2);
}

function toBool(v){
  return String(v||"false").toLowerCase() === "true";
}

function splitDomains(v){
  return String(v||"")
    .split(",")
    .map((d)=>d.trim().toLowerCase())
    .filter(Boolean);
}

function listZimbraServersFromIni(){
  const { cfgPath, obj } = readIniConfig();
  const keys = Object.keys(obj).filter((k)=>k.startsWith("MaMKey_"));
  const servers = keys.map((key)=>{
    const s = obj[key] || {};
    return {
      key,
      name: s.name || key,
      server: String(s.server || "").replace(/\/+$/, ""),
      domains: splitDomains(s.domains),
      preauthkey_masked: maskSecret(s.preauthkey || ""),
      soap_path: (s.soap_path || "/service/soap").trim(),
      preauth_path: (s.preauth_path || "/service/preauth").trim(),
      ca_file: (s.ca_file || "").trim() || undefined,
      insecure_tls: toBool(s.insecure_tls),
      // NOTE: preauthkey asli tidak dikirim ke frontend
    };
  });
  return { cfgPath, obj, servers };
}

function validateServerPayload(payload){
  const key = String(payload.key || "").trim();
  if(!/^MaMKey_\d+$/.test(key)) throw new Error("Key harus format MaMKey_<angka> (mis. MaMKey_1)");
  const name = String(payload.name || "").trim();
  const server = String(payload.server || "").trim().replace(/\/+$/, "");
  if(!server.startsWith("https://")) throw new Error("Server URL harus https://");
  const domains = Array.isArray(payload.domains) ? payload.domains : [];
  const domainsClean = domains.map(d=>String(d).trim().toLowerCase()).filter(Boolean);
  if(domainsClean.length === 0) throw new Error("Minimal 1 domain");
  const soap_path = String(payload.soap_path || "/service/soap").trim();
  const preauth_path = String(payload.preauth_path || "/service/preauth").trim();
  const ca_file = String(payload.ca_file || "").trim();
  const insecure_tls = !!payload.insecure_tls;
  const preauthkey = String(payload.preauthkey || "").trim();
  return { key, name, server, domains: domainsClean, soap_path, preauth_path, ca_file, insecure_tls, preauthkey };
}

async function quickSoapTest(serverCfg){
  const dispatcher = makeDispatcher({ caFile: serverCfg.caFile, insecureTls: serverCfg.insecureTls });
  const url = `${serverCfg.server}${serverCfg.soapPath}`;
  const body = `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope">
  <soap:Body>
    <NoOpRequest xmlns="urn:zimbraAccount"/>
  </soap:Body>
</soap:Envelope>`;
  const resp = await fetch(url, {
    method: "POST",
    dispatcher,
    headers: {
      "Content-Type": "application/soap+xml; charset=utf-8"
    },
    body
  });
  const text = await resp.text().catch(()=>"");
  const looksSoap = /Envelope/i.test(text) || /soap/i.test(text);
  return { status: resp.status, looksSoap };
}

app.post("/api/admin/login", async (req,res)=>{
  const {username, password} = req.body || {};
  if(!username || !password) return res.status(400).json({error:"username/password wajib diisi"});
  const db = readAdminDb(ADMIN_FILE);
  const u = db.users.find(x=>x.username===username);
  if(!u) return res.status(401).json({error:"Login admin gagal"});
  const ok = await bcrypt.compare(String(password), u.password_hash);
  if(!ok) return res.status(401).json({error:"Login admin gagal"});
  req.session.admin = { username };
  return res.json({ok:true});
});

app.post("/api/admin/logout", (req,res)=>{
  req.session.destroy(()=>res.json({ok:true}));
});

app.get("/api/admin/me", (req,res)=>{
  if(!req.session?.admin?.username) return res.json({loggedIn:false});
  return res.json({loggedIn:true, username:req.session.admin.username});
});

// --- Admin: manage Zimbra servers (writes to config.ini) ---
app.get("/api/admin/zimbra-servers", requireAdmin, (req,res)=>{
  try{
    const { servers } = listZimbraServersFromIni();
    res.json({ servers });
  }catch(e){
    res.status(500).json({ error: e.message || "Failed to read config" });
  }
});

app.post("/api/admin/zimbra-servers", requireAdmin, (req,res)=>{
  try{
    const payload = validateServerPayload(req.body || {});
    const { cfgPath, obj } = readIniConfig();
    if(obj[payload.key]) return res.status(400).json({ error: "Key sudah ada" });
    obj[payload.key] = {
      name: payload.name,
      server: payload.server,
      domains: payload.domains.join(","),
      preauthkey: payload.preauthkey,
      soap_path: payload.soap_path,
      preauth_path: payload.preauth_path,
      ca_file: payload.ca_file,
      insecure_tls: payload.insecure_tls ? "true" : "false",
    };
    writeIniConfig(cfgPath, obj);
    res.json({ ok: true });
  }catch(e){
    res.status(400).json({ error: e.message || "Bad request" });
  }
});

app.put("/api/admin/zimbra-servers/:key", requireAdmin, (req,res)=>{
  try{
    const key = String(req.params.key || "").trim();
    const payload = validateServerPayload({ ...(req.body||{}), key });
    const { cfgPath, obj } = readIniConfig();
    if(!obj[key]) return res.status(404).json({ error: "Server tidak ditemukan" });
    const prev = obj[key] || {};
    obj[key] = {
      ...prev,
      name: payload.name,
      server: payload.server,
      domains: payload.domains.join(","),
      preauthkey: payload.preauthkey ? payload.preauthkey : (prev.preauthkey || ""),
      soap_path: payload.soap_path,
      preauth_path: payload.preauth_path,
      ca_file: payload.ca_file,
      insecure_tls: payload.insecure_tls ? "true" : "false",
    };
    writeIniConfig(cfgPath, obj);
    res.json({ ok: true });
  }catch(e){
    res.status(400).json({ error: e.message || "Bad request" });
  }
});

app.delete("/api/admin/zimbra-servers/:key", requireAdmin, (req,res)=>{
  try{
    const key = String(req.params.key || "").trim();
    const { cfgPath, obj } = readIniConfig();
    if(!obj[key]) return res.status(404).json({ error: "Server tidak ditemukan" });
    delete obj[key];
    writeIniConfig(cfgPath, obj);
    res.json({ ok: true });
  }catch(e){
    res.status(500).json({ error: e.message || "Failed" });
  }
});

app.post("/api/admin/zimbra-servers/:key/test", requireAdmin, async (req,res)=>{
  try{
    const key = String(req.params.key || "").trim();
    const { obj } = readIniConfig();
    const s = obj[key];
    if(!s) return res.status(404).json({ ok:false, error: "Server tidak ditemukan" });

    const serverCfg = {
      server: String(s.server || "").replace(/\/+$/, ""),
      soapPath: String(s.soap_path || "/service/soap").trim(),
      caFile: String(s.ca_file || "").trim(),
      insecureTls: toBool(s.insecure_tls),
    };
    const tlsLabel = serverCfg.insecureTls ? "INSECURE" : (serverCfg.caFile ? "CUSTOM_CA" : "DEFAULT_CA");

    const test_email = req.body?.test_email;
    const test_password = req.body?.test_password;

    if(test_email && test_password){
      const r = await soapAuth({
        server: serverCfg.server,
        soapPath: serverCfg.soapPath,
        account: String(test_email),
        password: String(test_password),
        caFile: serverCfg.caFile,
        insecureTls: serverCfg.insecureTls,
      });
      if(r.ok) return res.json({ ok: true, details: { soap: "AUTH_OK", tls: tlsLabel, status: r.status } });
      return res.json({ ok: false, error: "AuthRequest failed", details: { soap: "AUTH_FAIL", tls: tlsLabel, status: r.status } });
    }

    const t = await quickSoapTest(serverCfg);
    if(t.looksSoap) return res.json({ ok: true, details: { soap: "REACHABLE", tls: tlsLabel, status: t.status } });
    return res.json({ ok: false, error: "SOAP endpoint not reachable", details: { soap: "UNREACHABLE", tls: tlsLabel, status: t.status } });
  }catch(e){
    res.status(500).json({ ok:false, error: e.message || "Test failed" });
  }
});

app.get("/api/admin/stats", requireAdmin, (req,res)=>{
  const entries = tailJsonl(LOG_FILE, 5000);
  res.json({stats: computeStats(entries)});
});

app.get("/api/admin/logs", requireAdmin, (req,res)=>{
  const limit = Math.min(Number(req.query.limit || 200), 2000);
  res.json({entries: tailJsonl(LOG_FILE, limit)});
});

app.get("/api/admin/users", requireAdmin, (req,res)=>{
  const db = readAdminDb(ADMIN_FILE);
  res.json({users: db.users.map(u=>({username:u.username, created_at:u.created_at}))});
});

app.post("/api/admin/users", requireAdmin, async (req,res)=>{
  const {username, password} = req.body || {};
  if(!username || !password) return res.status(400).json({error:"username/password wajib diisi"});
  const db = readAdminDb(ADMIN_FILE);
  if(db.users.some(u=>u.username===username)) return res.status(400).json({error:"username sudah ada"});
  db.users.push({username, password_hash: await bcrypt.hash(String(password),12), created_at:new Date().toISOString()});
  writeAdminDb(ADMIN_FILE, db);
  res.json({ok:true});
});

// SPA fallback for /admin
app.get(`${cfg0.adminBasePath}/*`, (req,res)=>{
  const adminIndex = path.join(__dirname, "public", "admin", "index.html");
  if(fs.existsSync(adminIndex)) return res.sendFile(adminIndex);
  res.status(404).send("Admin UI belum dibangun. Taruh build Lovable ke folder public/admin/");
});

async function start(){
  await ensureDefaultAdminExists();
  const cfg = loadConfig();
  if(cfg.httpsEnabled){
    const redirectApp = express();
    redirectApp.use((req,res)=>{
      const host = (req.headers.host||"").replace(/:\d+$/,"");
      res.redirect(301, `https://${host}:${cfg.httpsPort}${req.originalUrl}`);
    });

    http.createServer(redirectApp).listen(cfg.httpPort, ()=>console.log(`HTTP redirect on http://localhost:${cfg.httpPort} -> HTTPS`));

    const key = fs.readFileSync(cfg.tlsKeyFile);
    const cert = fs.readFileSync(cfg.tlsCertFile);
    https.createServer({key, cert}, app).listen(cfg.httpsPort, ()=>console.log(`MaM Portal (HTTPS) running on https://localhost:${cfg.httpsPort}`));
  } else {
    http.createServer(app).listen(cfg.httpPort, ()=>console.log(`MaM Portal running on http://localhost:${cfg.httpPort}`));
  }
}
start().catch((e)=>{
  console.error(e);
  process.exit(1);
});
