const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(
  process.env.SUPABASE_URL || "https://xbrfdeodeyihjxljhzfz.supabase.co",
  process.env.SUPABASE_SERVICE_KEY
);

const BUCKET = "erc-uploads";

// Supabase storage anahtarı Türkçe karakter/boşluk kabul etmez ("Invalid key").
// Görünen ad DB'de orijinal kalır; yalnız depolama yolu güvenli hale getirilir.
function safeStorageName(name) {
  const map = { ç: "c", Ç: "C", ğ: "g", Ğ: "G", ı: "i", İ: "I", ö: "o", Ö: "O", ş: "s", Ş: "S", ü: "u", Ü: "U" };
  return String(name || "dosya")
    .replace(/[çÇğĞıİöÖşŞüÜ]/g, (ch) => map[ch] || ch)
    .replace(/[^\w.\-]+/g, "_");
}

async function uploadToStorage(folder, filename, buffer, mimetype) {
  const filePath = `${folder}/${Date.now()}-${safeStorageName(filename)}`;
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(filePath, buffer, { contentType: mimetype, upsert: true });
  if (error) throw error;
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(filePath);
  return { url: data.publicUrl, filePath };
}

async function deleteFromStorage(filePath) {
  if (!filePath) return;
  // filePath can be full URL or just the path
  const path = filePath.includes("/storage/v1/object/public/")
    ? filePath.split(`/${BUCKET}/`)[1]
    : filePath;
  if (path) await supabase.storage.from(BUCKET).remove([path]);
}

// ── Özel kova (24.10.2026, Orhan): masraf fişlerinin ORİJİNAL fotoğrafları ────────────────────────────
// erc-uploads herkese açık URL verir; orijinal fotoğraf (fişin çevresi, kumaş, masa, başka belgeler) yalnız
// yetkili uç üzerinden akıtılır. Kova yoksa servis anahtarıyla bir kez oluşturulur (public:false).
// Oluşturulamaz / yüklenemezse orijinal, herkese açık kovada tahmin edilemez adla (128 bit rastgele) tutulur,
// URL'si hiçbir yanıtta verilmez; durum masraf_fis_isleme.orijinal_depo'ya ("genel-gizli-ad") yazılır ve loglanır.
const OZEL_BUCKET = process.env.SUPABASE_OZEL_BUCKET || "erc-ozel";
let _ozelHazir = null;
function ozelKovaHazirla() {
  if (!_ozelHazir) {
    _ozelHazir = (async () => {
      const { data } = await supabase.storage.getBucket(OZEL_BUCKET);
      if (data) { if (data.public) throw new Error(`${OZEL_BUCKET} kovası herkese açık — orijinaller oraya yazılmaz`); return true; }
      const { error } = await supabase.storage.createBucket(OZEL_BUCKET, { public: false });
      if (error && !/exist/i.test(error.message || "")) throw error;
      return true;
    })().catch((e) => { _ozelHazir = null; throw e; });
  }
  return _ozelHazir;
}
// Dönüş: { depo: "ozel" | "genel-gizli-ad", yol } — yol depo içi anahtar (URL değil)
async function ozelYukle(klasor, buffer, mimetype, uzanti = "jpg") {
  const ad = `${klasor}/${new Date().toISOString().slice(0, 10)}/${require("crypto").randomBytes(16).toString("hex")}.${uzanti}`;
  try {
    await ozelKovaHazirla();
    const { error } = await supabase.storage.from(OZEL_BUCKET).upload(ad, buffer, { contentType: mimetype, upsert: false });
    if (error) throw error;
    return { depo: "ozel", yol: ad };
  } catch (e) {
    console.error("[ozel-depo] özel kovaya yazılamadı, gizli adla genel kovaya yazılıyor:", e.message);
    const { error } = await supabase.storage.from(BUCKET).upload(`gizli/${ad}`, buffer, { contentType: mimetype, upsert: false });
    if (error) throw error;
    return { depo: "genel-gizli-ad", yol: `gizli/${ad}` };
  }
}
async function ozelIndir(depo, yol) {
  const { data, error } = await supabase.storage.from(depo === "ozel" ? OZEL_BUCKET : BUCKET).download(yol);
  if (error) throw error;
  return Buffer.from(await data.arrayBuffer());
}
async function ozelSil(depo, yol) {
  if (!yol) return;
  const { error } = await supabase.storage.from(depo === "ozel" ? OZEL_BUCKET : BUCKET).remove([yol]);
  if (error) throw error;
}

module.exports = { uploadToStorage, deleteFromStorage, supabase, BUCKET, ozelYukle, ozelIndir, ozelSil, ozelKovaHazirla };
