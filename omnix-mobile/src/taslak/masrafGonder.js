// Masraf kalemi gönderimi — adım adım, kaldığı yerden devam eden ve aynı kaydı iki kez oluşturmayan akış.
// React Native'e bağımlı değil: api, kaydet ve kırpma seçimi dışarıdan verilir (node --test ile sınanır).
//
// Adımlar: (1) kalem kaydı → kalemId taslağa yazılır  (2) her fiş: yükle → belgeId taslağa yazılır
//          (3) fiş yoksa "fişsiz" açıklaması  (4) bitti → taslak silinir (çağıran)
// Bağlantı koparsa (sonuç belirsiz) bir sonraki denemede önce sunucudaki form okunur, kayıt varsa yeniden oluşturulmaz.
import { kalemEslesmesi, yeniBelge } from "../mantik/uzlastirma.js";

export function kalemGovdesi(t) {
  const a = t.alanlar;
  const aciklama = a.siteId ? `Site ID: ${a.siteId.trim()}${a.aciklama?.trim() ? ` | ${a.aciklama.trim()}` : ""}` : (a.aciklama?.trim() || null);
  return {
    form_id: t.formId,
    kategori: a.kategori,
    tarih: a.tarih,
    belge_no: a.belgeNo?.trim() || null,
    belge_aciklama: a.belgeAciklama?.trim() || null,
    aciklama,
    tutar: a.tutar,
    plaka: a.plaka?.trim() ? a.plaka.trim().toUpperCase() : null,
    fis_var: !t.fissiz?.aktif,
  };
}

function ocrUyarisi(belge, tutar, kategori) {
  const ocr = belge?.ocr_tutar != null ? Number(belge.ocr_tutar) : null;
  if (ocr && tutar && Math.abs(ocr - tutar) > Math.max(tutar * 0.05, 10)) return { tur: "tutar", ocr, belgeId: belge.id };
  if (kategori === "YAKIT" && belge?.ocr_plaka && belge.ocr_plaka_eslesti === false) return { tur: "plaka", plaka: belge.ocr_plaka, belgeId: belge.id };
  return null;
}

/**
 * @param {object} p
 * @param {object} p.taslak — { id, formId, alanlar, fotolar[], fissiz, adim }
 * @param {(t:object)=>Promise<object>} p.kaydet — taslağı kalıcı yazar, güncel taslağı döner
 * @param {object} p.api — { form(id), kalemEkle(g), kalemGuncelle(id,g), belgeYukle(kid,dosya), fisIsle?(kid,dosya), fisEkle?(kid,isl,sec) }
 * @param {(yanit:object, foto:object)=>Promise<Array|null>} [p.kirpmaSec] — otomatik kırpma sonucu için kullanıcı seçimi
 * @param {()=>string} p.kimlik — istek kimliği üretir
 * @param {(uri:string)=>boolean} [p.fotoVarMi]
 * @returns {Promise<{ kalemId:number, uyarilar:object[], yarim?:boolean, yenidenCek?:{index:number, uri:string} }>}
 */
export async function kalemGonder({ taslak, kaydet, api, kirpmaSec, kimlik, fotoVarMi = () => true }) {
  let t = taslak;
  const yaz = async (degisim) => { t = await kaydet({ ...t, ...degisim }); return t; };
  const govde = kalemGovdesi(t);
  let form = null;
  const formuOku = async () => { form = await api.form(t.formId); return form; };

  // 1) Kalem
  if (!t.adim?.kalemId) {
    await formuOku();
    if (form?.durum && form.durum !== "TASLAK") {
      const h = new Error("Bu form onaya gönderilmiş; yeni kalem eklenemez. Kalemi yeni bir masraf formuna ekleyin.");
      h.kilit = true;
      throw h;
    }
    let eslesen = null;
    if (t.adim?.kalemDenendi) eslesen = kalemEslesmesi(form?.kalemler, t.adim.oncekiKalemIdleri, govde);
    if (eslesen) {
      await yaz({ adim: { ...t.adim, kalemId: eslesen.id } });
    } else {
      await yaz({ adim: { kalemDenendi: true, oncekiKalemIdleri: (form?.kalemler || []).map((k) => k.id) } });
      try {
        const k = await api.kalemEkle(govde);
        if (!k?.id) throw new Error("kalem kimliği yok");
        await yaz({ adim: { ...t.adim, kalemId: k.id } });
        form = null; // yeni kalem eklendi; fiş adımında güncel form okunur
      } catch (e) {
        // Kesin red (doğrulama/yetki) → sunucuda kayıt oluşmadı, bir sonraki deneme doğrudan gönderir
        if (!e?.sonucBelirsiz) await yaz({ adim: { kalemDenendi: false } });
        throw e;
      }
    }
  }
  const kalemId = t.adim.kalemId;
  const uyarilar = [];

  // 2) Fişler
  for (let i = 0; i < (t.fotolar || []).length; i++) {
    const f = t.fotolar[i];
    if (f.durum === "yuklendi") continue;
    const fotoGuncelle = async (d) => {
      const fotolar = t.fotolar.map((x, j) => (j === i ? { ...x, ...d } : x));
      await yaz({ fotolar });
    };
    if (!form) await formuOku();
    const kalem = (form?.kalemler || []).find((k) => String(k.id) === String(kalemId));
    if (f.denendi) {
      const yb = yeniBelge(kalem, f.oncekiBelgeIdler);
      if (yb) { await fotoGuncelle({ durum: "yuklendi", belgeId: yb.id }); continue; }
    }
    if (!fotoVarMi(f.uri)) throw new Error("Fiş fotoğrafı telefonda bulunamadı. Fotoğrafı yeniden ekleyin.");
    await fotoGuncelle({ denendi: true, oncekiBelgeIdler: (kalem?.belgeler || []).filter(Boolean).map((b) => b.id) });
    const dosya = { uri: f.uri, ad: f.ad, mime: f.mime };

    let belge = null;
    // Otomatik kırpma servisi varsa önce o; yoksa (eski sunucu) doğrudan yükleme
    if (api.fisIsle && kirpmaSec && !t.kirpmaServisiYok) {
      let yanit = null;
      try {
        yanit = await api.fisIsle(kalemId, dosya);
      } catch (e) {
        if (e?.tur === "bulunamadi" && !e?.sunucuMesaji) await yaz({ kirpmaServisiYok: true });
        else throw e;
      }
      if (yanit?.isleme_id) {
        const secimler = await kirpmaSec(yanit, f);
        // "Yeniden çek": bu fotoğraf eklenmez (sunucuda ek oluşmadı); çağıran yeni fotoğrafı aynı sıraya koyar
        if (secimler?.yenidenCek) { form = null; return { kalemId, uyarilar, yarim: true, yenidenCek: { index: i, uri: f.uri } }; }
        if (!Array.isArray(secimler) || !secimler.length) { form = null; return { kalemId, uyarilar, yarim: true }; }
        const istekler = secimler.map((s, n) => ({ ...s, istek_id: f.istekler?.[n] || kimlik() }));
        await fotoGuncelle({ istekler: istekler.map((s) => s.istek_id) }); // tekrar denemede aynı istek kimlikleri → çift ek yok
        const r = await api.fisEkle(kalemId, yanit.isleme_id, istekler);
        belge = (r?.belgeler || [r])[0];
      }
    }
    if (!belge) belge = await api.belgeYukle(kalemId, dosya);
    if (!belge?.id) throw new Error("Fiş yüklenemedi.");
    await fotoGuncelle({ durum: "yuklendi", belgeId: belge.id });
    const u = ocrUyarisi(belge, govde.tutar, govde.kategori);
    if (u) uyarilar.push(u);
    form = null;
  }

  // 3) Fişsiz kalem
  if (t.fissiz?.aktif && !(t.fotolar || []).length) {
    await api.kalemGuncelle(kalemId, { fis_var: false, fis_olmadan_aciklama: t.fissiz.aciklama.trim() });
  }
  return { kalemId, uyarilar };
}

// Yeniden çekilen fotoğraf eskisinin yerine geçer: gönderim adım bilgisi (denendi, istek kimlikleri) taşınmaz,
// böylece yeni fotoğraf yeni istekle eklenir; eski fotoğraf sunucuya hiç eklenmediği için çift ek oluşmaz.
export function fotoDegistir(fotolar, index, yeni) {
  return (fotolar || []).map((f, i) => (i === index ? { uri: yeni.uri, ad: yeni.ad, mime: yeni.mime, boyut: yeni.boyut, durum: "bekliyor" } : f));
}
