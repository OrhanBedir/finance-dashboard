// ═══ KİRACI ŞEMA EŞİTLEME (04.11.2026, Orhan) ═══════════════════════════════════════════════════════════════════
// İzole kiracılar (tenant_registry.isolated) kendi şemasında çalışır: search_path "t_<tenant>", public (db.js). Şema,
// kiracı onaylandığı an public'teki tabloların boş kopyasıyla kurulur (ensureTenantSchema) — ama SONRADAN eklenen tablo
// ve kolonlar kiracıya hiç geçmiyordu, çünkü açılış ALTER / CREATE'leri yalnız public'te çalışır. Sonuç:
//   • eksik KOLON → kiracıda sorgu hatası (04.11.2026 App Store reddi: t_omnixdemo.is_avans_talep.son_odeme_tarihi yok →
//     /hr/mobile-dashboard 500)
//   • eksik TABLO → search_path public'e düşer: kiracı ERC'nin verisini okur / ERC tablosuna yazar (kiracılar arası sızıntı)
// Bu modül her izole kiracı şemasını public'e eşitler — YALNIZ EKLEME: eksik tablo (LIKE public INCLUDING ALL, boş) ve
// eksik kolon (tip + varsayılan public'ten). Veri kopyalanmaz, silinmez, kolon tipi değiştirilmez.
// Kopyalanmayanlar: paylaşılan tablolar (users), kiracı kayıt defteri, yedek tabloları (_yedek_… / yedek_…).
// Ne zaman: açılıştan 90 sn sonra (açılış ALTER'ları bitmiş olur) ve her 15 dakikada bir; çalışırken ikinci çalışma
// başlamaz (pg_try_advisory_lock). Hata bir tabloda kalır, diğerleri sürer; özet günlüğe yazılır.
"use strict";

const ATLA_TABLO = (ad, paylasilan) => paylasilan.has(ad) || ad === "tenant_registry" || /^_?yedek_/i.test(ad);
const KILIT = 734001; // pg_try_advisory_lock anahtarı (bu modüle özel)
const kimlik = (s) => `"${String(s).replace(/"/g, '""')}"`;

// Saf: public kolon tanımından ADD COLUMN ifadesi (serial varsayılanı taşınmaz; NOT NULL yalnız varsayılan varsa)
function kolonIfadesi(sema, tablo, k) {
  const seri = /nextval\(/i.test(k.varsayilan || "");
  const tip = seri ? (/big/i.test(k.tip) ? "bigint" : "integer") : k.tip;
  const v = k.varsayilan && !seri ? ` DEFAULT ${k.varsayilan}` : "";
  const nn = k.nn && v ? " NOT NULL" : "";
  return `ALTER TABLE ${kimlik(sema)}.${kimlik(tablo)} ADD COLUMN IF NOT EXISTS ${kimlik(k.ad)} ${tip}${v}${nn}`;
}

// Tek kiracı şeması: eksik tablolar + eksik kolonlar. Dönen: { sema, tablo: [...], kolon: n, hata: [...] }
async function semaEsitle(client, sema, { paylasilan = new Set(["users"]) } = {}) {
  const sonuc = { sema, tablo: [], kolon: 0, hata: [] };
  const var_ = (await client.query(`SELECT 1 FROM pg_namespace WHERE nspname = $1`, [sema])).rowCount;
  if (!var_) return { ...sonuc, yok: true };
  const pub = (await client.query(`SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY 1`)).rows.map((r) => r.tablename);
  const kir = new Set((await client.query(`SELECT tablename FROM pg_tables WHERE schemaname = $1`, [sema])).rows.map((r) => r.tablename));
  for (const t of pub) {
    if (ATLA_TABLO(t, paylasilan) || kir.has(t)) continue;
    try {
      await client.query(`CREATE TABLE IF NOT EXISTS ${kimlik(sema)}.${kimlik(t)} (LIKE public.${kimlik(t)} INCLUDING ALL)`);
      sonuc.tablo.push(t); kir.add(t);
    } catch (e) { sonuc.hata.push(`${t}: ${e.message}`); }
  }
  const eksik = (await client.query(`
    SELECT c.table_name AS tablo, c.column_name AS ad, format_type(a.atttypid, a.atttypmod) AS tip,
           pg_get_expr(d.adbin, d.adrelid) AS varsayilan, a.attnotnull AS nn
    FROM information_schema.columns c
    JOIN pg_class pc ON pc.relname = c.table_name AND pc.relnamespace = 'public'::regnamespace AND pc.relkind = 'r'
    JOIN pg_attribute a ON a.attrelid = pc.oid AND a.attname = c.column_name AND NOT a.attisdropped
    LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
    WHERE c.table_schema = 'public'
      AND EXISTS (SELECT 1 FROM pg_tables k WHERE k.schemaname = $1 AND k.tablename = c.table_name)
      AND NOT EXISTS (SELECT 1 FROM information_schema.columns k WHERE k.table_schema = $1 AND k.table_name = c.table_name AND k.column_name = c.column_name)
    ORDER BY c.table_name, c.ordinal_position`, [sema])).rows;
  for (const k of eksik) {
    if (ATLA_TABLO(k.tablo, paylasilan)) continue;
    try { await client.query(kolonIfadesi(sema, k.tablo, k)); sonuc.kolon++; }
    catch (e) { sonuc.hata.push(`${k.tablo}.${k.ad}: ${e.message}`); }
  }
  return sonuc;
}

// Tüm izole kiracılar. pool: public havuzu (db.js varsayılan havuzu — search_path public)
async function hepsiniEsitle(pool, { kiracilar, semaAdi, paylasilan, log = console.log } = {}) {
  const liste = [...(kiracilar || [])];
  if (!liste.length) return [];
  const client = await pool.connect();
  try {
    const kilit = (await client.query(`SELECT pg_try_advisory_lock($1) AS ok`, [KILIT])).rows[0].ok;
    if (!kilit) return [];
    try {
      await client.query(`SET lock_timeout = '5s'`);
      const out = [];
      for (const t of liste) {
        const s = await semaEsitle(client, semaAdi(t), { paylasilan }).catch((e) => ({ sema: semaAdi(t), tablo: [], kolon: 0, hata: [e.message] }));
        out.push(s);
        if (s.tablo.length || s.kolon || s.hata.length)
          log(`[kiracı şema] ${s.sema}: ${s.tablo.length} tablo, ${s.kolon} kolon eklendi${s.hata.length ? `; ${s.hata.length} hata (ilk: ${s.hata[0]})` : ""}`);
      }
      return out;
    } finally { await client.query(`SELECT pg_advisory_unlock($1)`, [KILIT]).catch(() => {}); await client.query(`RESET lock_timeout`).catch(() => {}); }
  } finally { client.release(); }
}

// Zamanlayıcı: açılıştan sonra bir kez + aralıkla. Dönen: { simdi() } (yeni kiracı onayı / elle tetikleme için)
function kur(pool, { kiracilar, semaAdi, paylasilan, ilkMs = 90e3, aralikMs = 15 * 60e3, log } = {}) {
  const calis = () => hepsiniEsitle(pool, { kiracilar: kiracilar(), semaAdi, paylasilan, log }).catch((e) => console.error("[kiracı şema]", e.message));
  const t1 = setTimeout(calis, ilkMs); t1.unref?.();
  const t2 = setInterval(calis, aralikMs); t2.unref?.();
  return { simdi: calis };
}

module.exports = { kur, hepsiniEsitle, semaEsitle, kolonIfadesi, ATLA_TABLO };
