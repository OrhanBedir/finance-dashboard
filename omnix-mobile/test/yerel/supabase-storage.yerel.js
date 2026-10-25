// YALNIZ YEREL TEST: Supabase yerine yerel klasör. Canlı depoya hiçbir istek gitmez.
const fs = require("fs"), path = require("path"), crypto = require("crypto");
const KOK = process.env.OMNIX_YEREL_DEPO;
const URL_KOK = "http://127.0.0.1:5098";
const BUCKET = "erc-uploads";
const guvenli = (n) => String(n || "dosya").replace(/[^\w.\-]+/g, "_");
async function uploadToStorage(folder, filename, buffer) {
  const filePath = folder + "/" + Date.now() + "-" + guvenli(filename);
  fs.mkdirSync(path.join(KOK, folder), { recursive: true });
  fs.writeFileSync(path.join(KOK, filePath), buffer);
  return { url: URL_KOK + "/" + filePath, filePath };
}
async function deleteFromStorage(p) { if (!p) return; const rel = String(p).replace(URL_KOK + "/", ""); try { fs.unlinkSync(path.join(KOK, rel)); } catch {} }
async function ozelYukle(klasor, buffer, mimetype, uzanti = "jpg") {
  const yol = "ozel/" + klasor + "/" + crypto.randomBytes(16).toString("hex") + "." + uzanti;
  fs.mkdirSync(path.dirname(path.join(KOK, yol)), { recursive: true });
  fs.writeFileSync(path.join(KOK, yol), buffer);
  return { depo: "ozel", yol };
}
async function ozelIndir(depo, yol) { return fs.readFileSync(path.join(KOK, yol)); }
async function ozelSil(depo, yol) { try { fs.unlinkSync(path.join(KOK, yol)); } catch {} }
async function ozelKovaHazirla() { return true; }
const red = async () => ({ data: null, error: new Error("yerel test: supabase yok") });
const supabase = { storage: { from: () => ({ download: red, remove: red, createSignedUploadUrl: red, upload: red, getPublicUrl: () => ({ data: { publicUrl: "" } }) }), getBucket: red, createBucket: red } };
module.exports = { uploadToStorage, deleteFromStorage, supabase, BUCKET, ozelYukle, ozelIndir, ozelSil, ozelKovaHazirla };
