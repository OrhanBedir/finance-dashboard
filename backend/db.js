const { Pool } = require("pg");
const { AsyncLocalStorage } = require("async_hooks");

const isRemote = !!process.env.DATABASE_URL;

const localConfig = {
  host: process.env.DB_HOST || "localhost",
  port: Number(process.env.DB_PORT || 5432),
  user: process.env.DB_USER || "postgres",
  database: process.env.DB_NAME || "postgres",
  max: 10,
};

if (process.env.DB_PASSWORD && process.env.DB_PASSWORD !== "") {
  localConfig.password = process.env.DB_PASSWORD;
}

const remoteConfig = {
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 3,
  idleTimeoutMillis: 10000,
  connectionTimeoutMillis: 5000,
};

// ── Varsayılan (ERC) havuzu ──────────────────────────────────────────────────
// ERC ve token'sız tüm istekler bu havuzu kullanır. Bu havuzdaki bağlantılara
// ASLA "SET search_path" uygulanmaz → her zaman public şemasında kalır.
// Böylece ERC davranışı multi-tenant eklentisinden tamamen bağımsız/etkilenmez.
const pool = new Pool(isRemote ? remoteConfig : localConfig);

pool.on("error", (err) => {
  console.error("PostgreSQL pool error (ignored on Render):", err.message);
});

// ── Tenant (kiracı) havuzu ───────────────────────────────────────────────────
// Sadece erc dışındaki tenant istekleri için kullanılır. Bu havuzdaki
// bağlantılara her checkout'ta "SET search_path TO <tenant şeması>, public"
// uygulanır ve release'den önce public'e sıfırlanır. ERC havuzundan tamamen
// ayrı olduğu için, bu bağlantılarda kalan bir search_path durumu hiçbir zaman
// ERC isteklerine sızamaz.
const tenantPool = new Pool(isRemote ? remoteConfig : localConfig);
tenantPool.on("error", (err) => {
  console.error("PostgreSQL tenantPool error (ignored):", err.message);
});

// ── İstek bazlı tenant bağlamı ───────────────────────────────────────────────
// Bir istek erc dışı bir tenant'a aitse, o isteğin tüm süresi boyunca özel bir
// client AsyncLocalStorage içinde tutulur. pool.query, bu bağlam varsa o
// client'a yönlenir; yoksa (ERC/token'sız) doğrudan varsayılan havuzu kullanır.
const tenantContext = new AsyncLocalStorage();

const TENANT_SCHEMA_PREFIX = "t_";
function tenantSchema(tenant) {
  // Sadece güvenli karakterler (SQL injection / geçersiz şema adı koruması)
  const safe = String(tenant || "").toLowerCase().replace(/[^a-z0-9_]/g, "");
  return TENANT_SCHEMA_PREFIX + safe;
}

// pool.query'yi sar: tenant bağlamı varsa o isteğe bağlı client'ı kullan.
const _defaultQuery = pool.query.bind(pool);
pool.query = function (...args) {
  const store = tenantContext.getStore();
  if (store && store.client) {
    return store.client.query(...args);
  }
  return _defaultQuery(...args);
};

// Bir Express isteğini belirli bir tenant şemasına bağlar.
// erc / boş tenant için hiçbir şey yapmaz (next() doğrudan çağrılır) → ERC yolu
// byte-for-byte değişmez.
async function bindRequestToTenant(tenant, run) {
  if (!isIsolatedTenant(tenant)) {
    return run();
  }
  const schema = tenantSchema(tenant);
  let client;
  try {
    client = await tenantPool.connect();
  } catch (e) {
    console.error("[tenant] bağlantı alınamadı, public'e düşülüyor:", e.message);
    return run();
  }
  try {
    await client.query(`SET search_path TO "${schema}", public`);
  } catch (e) {
    console.error(`[tenant] search_path ayarlanamadı (${schema}):`, e.message);
  }
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    // Bağlantı havuza dönmeden önce public'e sıfırla (sızıntı koruması).
    client
      .query(`SET search_path TO public`)
      .catch(() => {})
      .finally(() => {
        try { client.release(); } catch {}
      });
  };
  try {
    return await tenantContext.run({ client, tenant, schema }, run);
  } finally {
    release();
  }
}

// Tüm tenant'larda paylaşılan, public'te kalan tablolar (kopyalanmaz).
const SHARED_PUBLIC_TABLES = new Set([
  "users", // kimlik doğrulama + tenant atama tek noktadan
]);

// ── İZOLE TENANT ALLOW-LIST ──────────────────────────────────────────────────
// ŞEMA İZOLASYONU YALNIZCA bu listedeki tenant'lar için devreye girer.
// Liste boşken middleware tamamen ETKİSİZDİR → tüm istekler public şemasında
// kalır (ERC + mevcut '2kx' taşeron görünümü byte-for-byte korunur).
// Yeni bir izole firma, ŞEMASI provizyon edildikten SONRA buraya eklenir.
// Önemli: legacy '2kx' (taşeron görünümü) bu listede OLMAMALIDIR.
const ISOLATED_TENANTS = new Set(
  String(process.env.ISOLATED_TENANTS || "")
    .split(",")
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean)
);
function isIsolatedTenant(tenant) {
  const t = String(tenant || "").toLowerCase();
  return !!t && t !== "erc" && ISOLATED_TENANTS.has(t);
}

// ── Tenant şeması provizyonu ─────────────────────────────────────────────────
// public şemasındaki tüm tabloları, yeni tenant şemasına aynı yapı ile (boş)
// kopyalar. Veri kopyalanmaz → yeni tenant sıfırdan başlar. ERC (public) hiç
// etkilenmez.
async function ensureTenantSchema(tenant) {
  const schema = tenantSchema(tenant);
  if (!tenant || tenant === "erc" || schema === TENANT_SCHEMA_PREFIX) {
    return { ok: false, error: "Geçersiz tenant" };
  }
  const client = await pool.connect(); // public havuzu — provizyon her zaman public'ten okur
  try {
    await client.query(`CREATE SCHEMA IF NOT EXISTS "${schema}"`);
    const { rows: tables } = await client.query(
      `SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename`
    );
    let created = 0;
    for (const { tablename } of tables) {
      // users gibi global/paylaşımlı tablolar tenant şemasına kopyalanmaz —
      // kimlik doğrulama tek bir users tablosundan yürür.
      if (SHARED_PUBLIC_TABLES.has(tablename)) continue;
      try {
        await client.query(
          `CREATE TABLE IF NOT EXISTS "${schema}"."${tablename}" (LIKE public."${tablename}" INCLUDING ALL)`
        );
        created++;
      } catch (e) {
        console.error(`[tenant-provision] ${schema}.${tablename}:`, e.message);
      }
    }
    return { ok: true, schema, tables_created: created };
  } finally {
    try { client.release(); } catch {}
  }
}

module.exports = pool;
module.exports.tenantPool = tenantPool;
module.exports.tenantContext = tenantContext;
module.exports.bindRequestToTenant = bindRequestToTenant;
module.exports.ensureTenantSchema = ensureTenantSchema;
module.exports.tenantSchema = tenantSchema;
module.exports.SHARED_PUBLIC_TABLES = SHARED_PUBLIC_TABLES;
module.exports.isIsolatedTenant = isIsolatedTenant;
module.exports.ISOLATED_TENANTS = ISOLATED_TENANTS;
