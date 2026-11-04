// Kiracı şema eşitleme — YALNIZ yerel test PostgreSQL'i (127.0.0.1:55432, geçici "kiraci_sema_test" veritabanı)
// Çalıştırma: node --test test/kiraciSema.test.js   (yerel PG yoksa atlanır)
const test = require("node:test");
const assert = require("node:assert/strict");
const { Client, Pool } = require("pg");
const K = require("../kiraciSema");

const YEREL = { host: "127.0.0.1", port: 55432, user: "postgres" };
let pool;
test.before(async () => {
  const c = new Client({ ...YEREL, database: "postgres" });
  try { await c.connect(); } catch { console.log("yerel PG yok — atlandı"); process.exit(0); }
  await c.query("DROP DATABASE IF EXISTS kiraci_sema_test"); await c.query("CREATE DATABASE kiraci_sema_test"); await c.end();
  pool = new Pool({ ...YEREL, database: "kiraci_sema_test", max: 2 });
  const q = (s) => pool.query(s);
  // Kiracı kurulduğu andaki public
  await q(`CREATE TABLE users (id SERIAL PRIMARY KEY, email TEXT)`);
  await q(`CREATE TABLE is_avans_talep (id SERIAL PRIMARY KEY, tutar NUMERIC NOT NULL, durum TEXT DEFAULT 'TALEP')`);
  await q(`CREATE SCHEMA t_demo`);
  await q(`CREATE TABLE t_demo.is_avans_talep (LIKE public.is_avans_talep INCLUDING ALL)`);
  await q(`INSERT INTO t_demo.is_avans_talep (tutar) VALUES (100)`);
  // Sonradan public'e eklenenler (açılış ALTER / CREATE)
  await q(`ALTER TABLE is_avans_talep ADD COLUMN son_odeme_tarihi DATE, ADD COLUMN surum INTEGER NOT NULL DEFAULT 1, ADD COLUMN zorunlu_ama_varsayilansiz TEXT NOT NULL DEFAULT 'x'`);
  await q(`ALTER TABLE is_avans_talep ALTER COLUMN zorunlu_ama_varsayilansiz DROP DEFAULT`);
  await q(`CREATE TABLE is_avans_tur (id BIGSERIAL PRIMARY KEY, talep_id INT, gerekce TEXT)`);
  await q(`INSERT INTO is_avans_tur (talep_id, gerekce) VALUES (1, 'ERC GİZLİ')`);
  await q(`CREATE TABLE _yedek_x_20261104 (id INT)`); await q(`CREATE TABLE yedek_users_1 (id INT)`);
  await q(`CREATE TABLE tenant_registry (tenant TEXT PRIMARY KEY)`);
});
test.after(async () => { await pool?.end(); });

test("kolon ifadesi: serial varsayılanı taşınmaz, NOT NULL yalnız varsayılanla", () => {
  assert.equal(K.kolonIfadesi("t_a", "x", { ad: "id2", tip: "integer", varsayilan: "nextval('x_id_seq'::regclass)", nn: true }), `ALTER TABLE "t_a"."x" ADD COLUMN IF NOT EXISTS "id2" integer`);
  assert.equal(K.kolonIfadesi("t_a", "x", { ad: "s", tip: "integer", varsayilan: "1", nn: true }), `ALTER TABLE "t_a"."x" ADD COLUMN IF NOT EXISTS "s" integer DEFAULT 1 NOT NULL`);
  assert.equal(K.kolonIfadesi("t_a", "x", { ad: "z", tip: "text", varsayilan: null, nn: true }), `ALTER TABLE "t_a"."x" ADD COLUMN IF NOT EXISTS "z" text`);
});

test("eşitleme: eksik kolon + eksik tablo eklenir, veri korunur, users/yedek/kayıt defteri kopyalanmaz", async () => {
  const r = await K.hepsiniEsitle(pool, { kiracilar: ["demo"], semaAdi: (t) => `t_${t}`, paylasilan: new Set(["users"]), log: () => {} });
  assert.equal(r[0].hata.length, 0, r[0].hata.join("; "));
  assert.deepEqual(r[0].tablo, ["is_avans_tur"]);
  assert.equal(r[0].kolon, 3);
  const tablolar = (await pool.query(`SELECT tablename FROM pg_tables WHERE schemaname='t_demo' ORDER BY 1`)).rows.map((x) => x.tablename);
  assert.deepEqual(tablolar, ["is_avans_talep", "is_avans_tur"], "users / yedek / tenant_registry kopyalanmaz");
  const satir = (await pool.query(`SELECT tutar, son_odeme_tarihi, surum FROM t_demo.is_avans_talep`)).rows[0];
  assert.equal(Number(satir.tutar), 100); assert.equal(satir.son_odeme_tarihi, null); assert.equal(satir.surum, 1);
  // Sızıntı kapandı: kiracı search_path'iyle is_avans_tur artık kiracının (boş) tablosu
  const c = await pool.connect();
  await c.query(`SET search_path TO t_demo, public`);
  assert.equal((await c.query(`SELECT COUNT(*)::int n FROM is_avans_tur`)).rows[0].n, 0, "ERC verisi görünmemeli");
  await c.query(`INSERT INTO is_avans_tur (talep_id, gerekce) VALUES (1, 'demo')`);
  await c.query(`SET search_path TO public`); c.release();
  assert.equal((await pool.query(`SELECT COUNT(*)::int n FROM public.is_avans_tur`)).rows[0].n, 1, "kiracı yazısı ERC tablosuna gitmez");
});

test("ikinci çalışma değişiklik yapmaz; şeması olmayan kiracı atlanır; eşzamanlı çalışma tek sefer", async () => {
  const [a, b] = await Promise.all([
    K.hepsiniEsitle(pool, { kiracilar: ["demo", "yok"], semaAdi: (t) => `t_${t}`, log: () => {} }),
    K.hepsiniEsitle(pool, { kiracilar: ["demo"], semaAdi: (t) => `t_${t}`, log: () => {} }),
  ]);
  const calisan = a.length ? a : b;
  assert.equal(calisan[0].tablo.length + calisan[0].kolon, 0);
  if (a.length) assert.equal(a[1].yok, true);
});
