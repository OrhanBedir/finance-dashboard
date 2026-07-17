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

module.exports = { uploadToStorage, deleteFromStorage, supabase, BUCKET };
