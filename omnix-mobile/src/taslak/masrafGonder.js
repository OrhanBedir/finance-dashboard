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
 * @param {(foto:object)=>Promise<"kirpmadan"|"tekrar"|null>} [p.kirpmaYok] — kırpma servisi yanıt vermediğinde açık kullanıcı
 *   kararı (06.11.2026): "kirpmadan" = orijinali bilerek ekle; diğerleri = fiş eklenmez, kalem kayıtlı kalır, tekrar denenir
 * @param {()=>string} p.kimlik — istek kimliği üretir
 * @param {(uri:string)=>boolean} [p.fotoVarMi]
 * @param {(a:{kod:string, sira?:number, toplam?:number})=>void} [p.onAsama] — ilerleme bildirimi (04.11.2026): ekran kullanıcıya
 *   hangi adımda olunduğunu gösterir. kod: kalem | fis_isleme (yükle + otomatik kırpma, ~20 sn) | kirpma_onay | okuma (tutar/plaka) |
 *   fis_yukleme (kırpma servisi yoksa: yükle + oku) | fissiz | bitti. sira/toplam: fiş sırası (1'den), gönderilecek fiş sayısı.
 * @returns {Promise<{ kalemId:number, uyarilar:object[], yarim?:boolean, yenidenCek?:{index:number, uri:string} }>}
 */
export async function kalemGonder({ taslak, kaydet, api, kirpmaSec, kirpmaYok, kimlik, fotoVarMi = () => true, onAsama }) {
  let t = taslak;
  const asama = (kod, ek) => { try { onAsama?.({ kod, ...ek }); } catch (_) { /* ekran hatası gönderimi bozmasın */ } };
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
      asama("kalem");
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

  // 2) Fişler — sıra bilgisi yalnız gönderilecek (henüz yüklenmemiş) fişler üzerinden: "Fiş 2/3"
  const bekleyen = (t.fotolar || []).map((f, i) => (f.durum === "yuklendi" ? -1 : i)).filter((i) => i >= 0);
  for (let i = 0; i < (t.fotolar || []).length; i++) {
    const f = t.fotolar[i];
    if (f.durum === "yuklendi") continue;
    const sira = { sira: bekleyen.indexOf(i) + 1, toplam: bekleyen.length };
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
    // 06.11.2026: fotoğraf seçilirken kırpması onaylandıysa (kalemsiz ön işleme) aynı işlem bu kaleme bağlanır — model
    // ikinci kez çağrılmaz. Sunucu işlemi bulamazsa (süresi doldu / başka kalem) ön onay düşer, aşağıdaki akış yeniden sorar.
    if (f.onIsleme?.isleme_id && Array.isArray(f.onIsleme.secimler) && f.onIsleme.secimler.length && api.fisEkle) {
      const istekler = f.onIsleme.secimler.map((s, n) => ({ ...s, istek_id: f.istekler?.[n] || kimlik() }));
      await fotoGuncelle({ istekler: istekler.map((s) => s.istek_id) });
      asama("okuma", sira);
      try {
        const r = await api.fisEkle(kalemId, f.onIsleme.isleme_id, istekler);
        belge = (r?.belgeler || [r])[0];
      } catch (e) {
        if (!(e?.tur === "bulunamadi" || [404, 409, 410].includes(e?.durumKodu))) throw e;
        await fotoGuncelle({ onIsleme: null, istekler: null });
      }
    }
    // Kullanıcı fotoğraf eklerken kırpma yapılamadığı için "Kırpmadan kullan"ı AÇIKÇA seçtiyse orijinal eklenir (kirpildi=0)
    if (!belge && f.kirpmadanOnay) { asama("fis_yukleme", sira); belge = await api.belgeYukle(kalemId, dosya); }
    // Otomatik kırpma servisi; yanıt vermezse kullanıcıya açıkça sorulur (sessizce orijinal yüklenmez). Eski taslaklardaki
    // kalıcı "kirpmaServisiYok" işareti artık okunmaz: her gönderimde servis yeniden denenir.
    if (!belge && api.fisIsle && kirpmaSec) {
      let yanit = null;
      try {
        asama("fis_isleme", sira);
        yanit = await api.fisIsle(kalemId, dosya);
      } catch (e) {
        // Yalnız "uç yok" (eski sunucu, sunucu mesajı olmayan 404) kırpmasız eklemeye izin verir — kalem bulunamadı,
        // yetki ve ağ hataları olduğu gibi gösterilir
        if (!(e?.tur === "bulunamadi" && !e?.sunucuMesaji)) throw e;
        const karar = kirpmaYok ? await kirpmaYok(f) : null;
        if (karar !== "kirpmadan") { form = null; return { kalemId, uyarilar, yarim: true }; }
        asama("fis_yukleme", sira);
        belge = await api.belgeYukle(kalemId, dosya);
      }
      if (yanit?.isleme_id) {
        asama("kirpma_onay", sira);
        const secimler = await kirpmaSec(yanit, f);
        // "Yeniden çek": bu fotoğraf eklenmez (sunucuda ek oluşmadı); çağıran yeni fotoğrafı aynı sıraya koyar
        if (secimler?.yenidenCek) { form = null; return { kalemId, uyarilar, yarim: true, yenidenCek: { index: i, uri: f.uri } }; }
        if (!Array.isArray(secimler) || !secimler.length) { form = null; return { kalemId, uyarilar, yarim: true }; }
        const istekler = secimler.map((s, n) => ({ ...s, istek_id: f.istekler?.[n] || kimlik() }));
        await fotoGuncelle({ istekler: istekler.map((s) => s.istek_id) }); // tekrar denemede aynı istek kimlikleri → çift ek yok
        asama("okuma", sira);
        const r = await api.fisEkle(kalemId, yanit.isleme_id, istekler);
        belge = (r?.belgeler || [r])[0];
      }
    }
    // Kırpma servisi tanımlı değilse (test / eski yapı) doğrudan yükleme
    if (!belge && !(api.fisIsle && kirpmaSec)) { asama("fis_yukleme", sira); belge = await api.belgeYukle(kalemId, dosya); }
    if (!belge?.id) throw new Error("Fiş yüklenemedi.");
    await fotoGuncelle({ durum: "yuklendi", belgeId: belge.id });
    const u = ocrUyarisi(belge, govde.tutar, govde.kategori);
    if (u) uyarilar.push(u);
    form = null;
  }

  // 3) Fişsiz kalem
  if (t.fissiz?.aktif && !(t.fotolar || []).length) {
    asama("fissiz");
    await api.kalemGuncelle(kalemId, { fis_var: false, fis_olmadan_aciklama: t.fissiz.aciklama.trim() });
  }
  asama("bitti");
  return { kalemId, uyarilar };
}

// Yeniden çekilen fotoğraf eskisinin yerine geçer: gönderim adım bilgisi (denendi, istek kimlikleri) taşınmaz,
// böylece yeni fotoğraf yeni istekle eklenir; eski fotoğraf sunucuya hiç eklenmediği için çift ek oluşmaz.
export function fotoDegistir(fotolar, index, yeni) {
  return (fotolar || []).map((f, i) => (i === index ? { uri: yeni.uri, ad: yeni.ad, mime: yeni.mime, boyut: yeni.boyut, durum: "bekliyor", ...(yeni.onIsleme ? { onIsleme: yeni.onIsleme, onizlemeUri: yeni.onizlemeUri } : {}) } : f));
}
