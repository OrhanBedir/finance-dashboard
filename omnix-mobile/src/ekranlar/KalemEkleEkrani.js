// Masraf kalemi ekleme + fiş. Girilen her şey yazarken telefona kaydedilir (taslak); bağlantı koparsa
// form ve fotoğraflar kaybolmaz, "Gönderildi" görünmez; tekrar denemede kalınan adımdan devam edilir.
import React, { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Alert, Image, Linking, Modal, Pressable, ScrollView, Switch, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { aralik, kose, renk, yazi } from "../tema";
import { BolumBasligi, Buton, Kart, Metin } from "../bilesenler/temel";
import { Bant } from "../bilesenler/durum";
import { Alan, TarihAlani, TutarAlani } from "../bilesenler/form";
import { Ekran } from "../bilesenler/Ekran";
import { useOturum } from "../oturum/OturumSaglayici";
import { useGecersizKil } from "../api/veri";
import { avansApi, masrafApi } from "../api/uclar";
import { isoGun, tarih, tl, tutarCoz } from "../mantik/bicim";
import { hataMetni } from "../mantik/hata";
import { MASRAF_KATEGORILERI, kategori } from "../mantik/sabitler";
import { fotoSil, fotoVarMi, onizlemeSakla, taslak as taslakOku, taslakKaydet, taslakSil, yeniKimlik } from "../taslak/taslakDepo";
import { fisSec, FisHatasi } from "../taslak/fis";
import { KoseDuzenleyici } from "../bilesenler/KoseDuzenleyici";
import { fotoDegistir, kalemGonder } from "../taslak/masrafGonder";

const BOS = { kategori: null, tarih: isoGun(), tutarMetni: "", aciklama: "", belgeNo: "", belgeAciklama: "", plaka: "", siteId: "" };

export function KalemEkleEkrani({ navigation, route }) {
  const { formId, taslakId, mevcutKalem } = route.params;
  const { kullanici, kapsam } = useOturum();
  const gecersizKil = useGecersizKil();
  // Mevcut kaleme fiş ekleme: taslak kimliği kaleme bağlıdır, tekrar girince aynı taslaktan devam edilir
  const [id] = useState(() => taslakId || (mevcutKalem ? `kalem-${mevcutKalem.id}` : yeniKimlik()));
  const [alanlar, setAlanlar] = useState(BOS);
  const [fotolar, setFotolar] = useState([]);
  const [fissiz, setFissiz] = useState({ aktif: false, aciklama: "" });
  const [kayitli, setKayitli] = useState(null); // telefondaki taslak (adım bilgisiyle)
  const [hatalar, setHatalar] = useState({});
  const [gonderiliyor, setGonderiliyor] = useState(false);
  const [gonderimHatasi, setGonderimHatasi] = useState(null);
  const [kirpma, setKirpma] = useState(null); // { yanit, foto, coz }
  const [uyarilar, setUyarilar] = useState(null); // gönderim sonrası OCR uyarıları
  const [atananPlaka, setAtananPlaka] = useState("");
  const [fotoHazir, setFotoHazir] = useState(false); // fotoğraf seçilip hazırlanıyor
  const kilit = useRef(false);
  const yuklendi = useRef(!taslakId && !mevcutKalem);
  // 04.11.2026: gönderim ilerlemesi — fiş bulma ~20 sn sürer; kullanıcı ekran dondu sanmasın
  const [asama, setAsama] = useState(null); // { kod, sira, toplam, t } | null
  const [baslangic, setBaslangic] = useState(null);
  const gonderimSuruyor = useRef(false); // geri gitme engeli (başarıyla bitince bırakılır)

  // Var olan taslağı aç (ya da mevcut kalem için yeni "fiş ekle" taslağı hazırla)
  useEffect(() => {
    if (!taslakId && !mevcutKalem) return;
    taslakOku(kapsam, id).then((t) => {
      if (!t && mevcutKalem) {
        const k = mevcutKalem;
        const aciklama = String(k.aciklama || "");
        const site = aciklama.match(/^Site ID:\s*([^|]+?)\s*(?:\|\s*(.*))?$/);
        setAlanlar({ ...BOS, kategori: k.kategori, tarih: k.tarih ? isoGun(k.tarih) : isoGun(), /* sunucu UTC döndürür; yerel güne çevrilir */ tutarMetni: String(Number(k.tutar) || ""),
          aciklama: site ? site[2] || "" : aciklama, siteId: site ? site[1] : "", plaka: k.plaka || "", belgeNo: k.belge_no || "", belgeAciklama: k.belge_aciklama || "" });
        setKayitli({ id, adim: { kalemId: k.id } }); // telefona yalnız fotoğraf/fişsiz açıklaması girilince yazılır
        yuklendi.current = true;
        return;
      }
      if (t) {
        setAlanlar({ ...BOS, ...t.alanlarHam });
        // Uygulama fiş algılanırken kapandıysa işlem yarıda kalmıştır: kullanıcıya yeniden sorulur (başarı varsayılmaz)
        setFotolar((t.fotolar || []).filter((f) => f.durum === "yuklendi" || fotoVarMi(f.uri))
          .map((f) => (f.onIsleme?.durum === "isleniyor" ? { ...f, onIsleme: { durum: "hata", mesaj: "Fiş algılama yarıda kaldı." } } : f)));
        setFissiz(t.fissiz || { aktif: false, aciklama: "" });
        setKayitli(t);
        setGonderimHatasi(t.gonderimHatasi || null);
      }
      yuklendi.current = true;
    });
  }, [kapsam, taslakId]);

  // Gönderim sürerken geri gitme (geri düğmesi / kaydırma / Android geri) engellenir; kayıt telefonda saklıdır
  useEffect(() => navigation.addListener("beforeRemove", (e) => {
    if (!gonderimSuruyor.current) return;
    e.preventDefault();
    Alert.alert("Kayıt sürüyor", "Lütfen bitmesini bekleyin. Bilgileriniz telefonda saklı; uygulama kapanırsa 'Kaydet' ile kaldığı yerden devam eder, aynı kayıt ikinci kez oluşmaz.");
  }), [navigation]);

  useEffect(() => {
    avansApi.atananArac(kullanici).then((d) => { if (d?.plaka) setAtananPlaka(String(d.plaka).toUpperCase()); }).catch(() => {});
  }, [kullanici]);

  // Yazarken otomatik kaydet (yalnız bir şey girildiyse)
  const doluMu = mevcutKalem ? fotolar.length || fissiz.aktif : alanlar.kategori || alanlar.tutarMetni || alanlar.aciklama || fotolar.length;
  // Mevcut kalemde kalem kimliği sabittir; her kayıtta yazılır ki gönderim yeni kalem açmasın
  const sabitAdim = (onceki) => (mevcutKalem ? { adim: { ...(onceki || {}), kalemId: mevcutKalem.id } } : {});
  // Gönderim adım bilgisi (adim, fotoğraf durumları) yalnız gönderim akışı tarafından yazılır; otomatik kayıt
  // yalnız kullanıcının girdiği alanları yazar ve gönderim başlarken iptal edilir — eski bilgi yenisinin üzerine yazılmaz.
  const otoKayit = useRef(null);
  useEffect(() => {
    if (!yuklendi.current || !doluMu || gonderiliyor) return;
    otoKayit.current = setTimeout(() => {
      otoKayit.current = null;
      taslakKaydet(kapsam, {
        id, tur: "masrafKalem", formId, alanlarHam: alanlar, fissiz, ...sabitAdim(kayitli?.adim),
        // durum alanları depoda birleştirilir; kırpma onayı (onIsleme, önizleme, açık "kırpmadan" seçimi) kullanıcı kararıdır, yazılır
        fotolar: fotolar.map((f) => ({ uri: f.uri, ad: f.ad, mime: f.mime, boyut: f.boyut, onIsleme: f.onIsleme ?? null, onizlemeUri: f.onizlemeUri ?? null, kirpmadanOnay: !!f.kirpmadanOnay })),
      }).then(setKayitli).catch(() => {});
    }, 400);
    return () => { if (otoKayit.current) clearTimeout(otoKayit.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [alanlar, fotolar, fissiz]);

  const kat = alanlar.kategori ? kategori(alanlar.kategori) : null;
  const set = (k, v) => { setAlanlar((a) => ({ ...a, [k]: v })); setHatalar((h) => ({ ...h, [k]: null })); };
  const kalemKaydedildi = !!kayitli?.adim?.kalemId;

  const katSec = (k) => {
    set("kategori", k);
    const yeni = kategori(k);
    if (yeni.plaka && !alanlar.plaka && atananPlaka && k !== "TRAFIK_CEZA") set("plaka", atananPlaka);
  };

  // 06.11.2026: fotoğraf seçilir seçilmez fiş algılanır ve kırpılmış önizleme onaya sunulur (kalem kaydı beklenmez).
  // Sunucu işlemi forma bağlı ve geçicidir; "Kaydet"te aynı işlem kaleme bağlanır, model ikinci kez çalışmaz.
  const fotoYaz = (uri, d) => setFotolar((l) => l.map((x) => (x.uri === uri ? { ...x, ...d } : x)));
  const fotoCikar = (f) => { setFotolar((l) => l.filter((x) => x.uri !== f.uri)); fotoSil(f.uri); if (f.onizlemeUri) fotoSil(f.onizlemeUri); };
  const onIsle = async (f) => {
    const isFormId = formId || mevcutKalem?.form_id;
    if (!isFormId || !masrafApi.fisOnIsle) return; // form yoksa eski akış: kırpma "Kaydet"te
    fotoYaz(f.uri, { onIsleme: { durum: "isleniyor" }, kirpmadanOnay: false });
    let yanit;
    try {
      yanit = await masrafApi.fisOnIsle(isFormId, { uri: f.uri, ad: f.ad, mime: f.mime });
      if (!yanit?.isleme_id) throw new Error("Sunucudan beklenmeyen yanıt geldi.");
    } catch (e) {
      const mesaj = e?.tur === "bulunamadi" && !e?.sunucuMesaji ? "Sunucu bu özelliği henüz desteklemiyor." : hataMetni(e, e?.message || "Fiş algılanamadı.");
      fotoYaz(f.uri, { onIsleme: { durum: "hata", mesaj } });
      Alert.alert("Otomatik kırpma yapılamadı", `${mesaj}\n\nFotoğraf telefonda saklı.`, [
        { text: "Tekrar dene", onPress: () => onIsle(f) },
        { text: "Kırpmadan kullan", onPress: () => fotoYaz(f.uri, { onIsleme: { durum: "kirpmadan" }, kirpmadanOnay: true }) },
        { text: "Kaydederken dene", style: "cancel" },
      ]);
      return;
    }
    const secim = await kirpmaSec(yanit, f);
    if (secim?.yenidenCek) { fotoCikar(f); setTimeout(() => fotoEkle("kamera"), 300); return; }
    if (!Array.isArray(secim) || !secim.length) { fotoCikar(f); return; } // vazgeçildi: fotoğraf eklenmez
    // Küçük önizleme onaylanan kırpmayı gösterir: otomatik aday → sunucu önizlemesi; köşe düzeltme/kırpmasız → orijinal + etiket
    const tek = secim.length === 1 ? secim[0] : null;
    const tur = secim.some((x) => x.kirpma === "yok") ? "kirpmadan" : secim.some((x) => x.kose) ? "duzeltildi" : "kirpik";
    const aday = (yanit.adaylar || []).find((a) => a.no === (tek?.aday_no ?? secim[0]?.aday_no));
    let onizlemeUri = null;
    if (tur === "kirpik" && aday?.onizleme) { try { onizlemeUri = onizlemeSakla(kapsam, aday.onizleme)?.uri || null; } catch { onizlemeUri = null; } }
    // Köşeler elle düzeltildiyse küçük önizleme de o kırpmayı göstersin: sunucu saklı orijinalden aynı kırpmayı üretir.
    // Önizleme alınamazsa yalnız küçük resim orijinal kalır (rozet "Düzeltildi"); kaydedilecek ek yine sunucuda kırpılır.
    if (tur === "duzeltildi" && secim.length === 1 && tek?.kose && masrafApi.fisOnizle) {
      try { const o = await masrafApi.fisOnizle(yanit.isleme_id, tek.kose); onizlemeUri = onizlemeSakla(kapsam, o?.onizleme)?.uri || null; } catch { onizlemeUri = null; }
    }
    fotoYaz(f.uri, { onIsleme: { durum: "onaylandi", isleme_id: yanit.isleme_id, secimler: secim, tur, adet: secim.length }, onizlemeUri, istekler: null, kirpmadanOnay: false });
  };

  const fotoEkle = async (kaynak) => {
    if (fotoHazir) return;
    setFotoHazir(true);
    let eklenen = null;
    try {
      const f = await fisSec(kaynak, kapsam);
      if (!f) return; // vazgeçildi
      eklenen = { ...f, durum: "bekliyor" };
      setFotolar((l) => [...l, eklenen]);
      setFissiz({ aktif: false, aciklama: "" });
    } catch (e) {
      if (e instanceof FisHatasi && e.ayarlar) {
        Alert.alert("İzin gerekli", e.message, [{ text: "Vazgeç", style: "cancel" }, { text: "Ayarları aç", onPress: () => Linking.openSettings() }]);
      } else {
        Alert.alert("Fotoğraf eklenemedi", e instanceof FisHatasi ? e.message : "Fotoğraf eklenirken bir sorun oluştu.");
      }
    } finally {
      setFotoHazir(false);
    }
    if (eklenen) onIsle(eklenen);
  };

  const fotoKaldir = (i) => {
    const f = fotolar[i];
    if (f.durum === "yuklendi") return; // sunucuya gitmiş fiş buradan silinmez
    if (f.onIsleme?.durum === "isleniyor") return; // algılama sürerken kaldırılmaz (sonuç penceresi gelir, orada vazgeçilir)
    fotoCikar(f);
  };
  const algilaniyor = fotolar.some((f) => f.onIsleme?.durum === "isleniyor");

  const dogrula = () => {
    const h = {};
    if (!alanlar.kategori) h.kategori = "Harcama türünü seçin.";
    const tutar = tutarCoz(alanlar.tutarMetni);
    if (!tutar) h.tutarMetni = "Geçerli bir tutar girin (ör. 1.250,50).";
    if (kat?.plaka && alanlar.kategori === "YAKIT" && !alanlar.plaka.trim()) h.plaka = "Araç plakasını girin.";
    if (!fotolar.length && !fissiz.aktif) h.fis = "Fiş fotoğrafı ekleyin ya da fiş olmadığını belirtin.";
    if (fissiz.aktif && !fissiz.aciklama.trim()) h.fissizAciklama = "Fiş olmamasının nedenini yazın.";
    setHatalar(h);
    return Object.keys(h).length ? null : tutar;
  };

  const fissizDegistir = () => { setFissiz((x) => ({ ...x, aktif: !x.aktif })); setHatalar((h) => ({ ...h, fis: null })); };

  const kirpmaSec = useCallback((yanit, foto) => new Promise((coz) => setKirpma({ yanit, foto, coz })), []);

  // Kırpma ekranından "Yeniden çek": kamera açılır (kamera yoksa galeri önerilir), yeni fotoğraf eskisinin yerine geçer
  // ve gönderim kaldığı yerden sürer. Vazgeçilirse eski fotoğraf taslakta kalır, hiçbir şey eklenmez.
  const yenidenCek = async ({ index, uri }) => {
    let yeni = null;
    try {
      yeni = await fisSec("kamera", kapsam);
    } catch (e) {
      const galeri = await new Promise((coz) => Alert.alert("Kamera açılamadı", e instanceof FisHatasi ? e.message : "Kamera kullanılamıyor.", [
        { text: "Vazgeç", style: "cancel", onPress: () => coz(false) },
        ...(e instanceof FisHatasi && e.ayarlar ? [{ text: "Ayarları aç", onPress: () => { Linking.openSettings(); coz(false); } }] : []),
        { text: "Galeriden seç", onPress: () => coz(true) },
      ]));
      if (galeri) { try { yeni = await fisSec("galeri", kapsam); } catch (e2) { Alert.alert("Fotoğraf eklenemedi", e2?.message || ""); } }
    }
    if (!yeni) { setGonderimHatasi("Fiş eklenmedi. Fotoğrafı yeniden çekmek ya da mevcut fotoğrafla devam etmek için 'Kaydet'e dokunun."); return; }
    const t = (await taslakOku(kapsam, id)) || {};
    const yeniFotolar = fotoDegistir(t.fotolar || fotolar, index, yeni);
    await taslakKaydet(kapsam, { ...t, id, fotolar: yeniFotolar });
    setFotolar(yeniFotolar);
    fotoSil(uri);
    setTimeout(() => gonder(), 50);
  };

  const gonder = async () => {
    if (kilit.current) return;
    if (algilaniyor) { Alert.alert("Fiş algılanıyor", "Fotoğraftaki fiş bulunuyor; bitince kırpılmış hali onayınıza gelecek."); return; }
    const tutar = dogrula();
    if (!tutar) return;
    kilit.current = true;
    gonderimSuruyor.current = true;
    if (otoKayit.current) { clearTimeout(otoKayit.current); otoKayit.current = null; }
    setAsama(null); setBaslangic(Date.now());
    setGonderiliyor(true);
    setGonderimHatasi(null);
    try {
      // Telefondaki son adım bilgisi (kalemId, fotoğrafların denenme durumu) korunur; yalnız alanlar güncellenir
      const once = (await taslakOku(kapsam, id)) || {};
      const temel = await taslakKaydet(kapsam, {
        id, tur: "masrafKalem", formId, alanlarHam: alanlar, fissiz, gonderimHatasi: null, ...sabitAdim(once.adim),
        // Gönderim adım bilgisi telefondan; kırpma onayı ise ekrandaki son kullanıcı kararıdır (otomatik kayıt henüz yazmamış olabilir)
        fotolar: fotolar.map((f) => ({ ...f, ...(once.fotolar || []).find((x) => x.uri === f.uri),
          ...(f.onIsleme !== undefined ? { onIsleme: f.onIsleme, onizlemeUri: f.onizlemeUri ?? null, kirpmadanOnay: !!f.kirpmadanOnay } : {}) })),
        alanlar: { ...alanlar, tutar },
      });
      const sonuc = await kalemGonder({
        taslak: temel,
        kaydet: async (t) => { const y = await taslakKaydet(kapsam, t); setKayitli(y); setFotolar(y.fotolar); return y; },
        api: masrafApi,
        kirpmaSec,
        kirpmaYok: () => new Promise((coz) => Alert.alert("Otomatik kırpma yapılamadı", "Kırpma servisine ulaşılamadı. Kalem kaydedildi; fişi kırpmadan ekleyebilir ya da daha sonra tekrar deneyebilirsiniz.", [
          { text: "Daha sonra", style: "cancel", onPress: () => coz(null) },
          { text: "Kırpmadan ekle", onPress: () => coz("kirpmadan") },
        ])),
        kimlik: () => yeniKimlik().replace(/-/g, ""),
        fotoVarMi,
        onAsama: (a) => setAsama({ ...a, t: Date.now() }),
      });
      gecersizKil([`masrafForm:${formId}`, "masrafFormlar", "hesap", "pano"]);
      if (sonuc.yenidenCek) {
        kilit.current = false;
        gonderimSuruyor.current = false;
        setGonderiliyor(false);
        await yenidenCek(sonuc.yenidenCek);
        return;
      }
      if (sonuc.yarim) {
        setGonderimHatasi("Fiş ekleme yarıda kaldı. Kalem kaydedildi; fişi eklemek için tekrar 'Kaydet'e dokunun.");
        return;
      }
      await taslakSil(kapsam, id);
      gonderimSuruyor.current = false;
      if (sonuc.uyarilar.length) { setUyarilar({ kalemId: sonuc.kalemId, liste: sonuc.uyarilar, girilen: tutar }); return; }
      navigation.goBack();
    } catch (e) {
      const mesaj = e?.kilit ? e.message : e?.sonucBelirsiz
        ? "Bağlantı koptu. Bilgileriniz ve fotoğraflarınız telefonda saklandı; tekrar deneyin — aynı kayıt ikinci kez oluşmaz."
        : hataMetni(e, e?.message || "Kaydedilemedi.");
      setGonderimHatasi(mesaj);
      taslakKaydet(kapsam, { id, gonderimHatasi: mesaj }).then(setKayitli).catch(() => {});
    } finally {
      kilit.current = false;
      gonderimSuruyor.current = false;
      setGonderiliyor(false);
      setAsama(null); setBaslangic(null);
    }
  };

  const taslagiSil = () => {
    Alert.alert("Taslak silinsin mi?", kalemKaydedildi ? "Kalem sunucuya kaydedildi; yalnız telefondaki bekleyen fişler silinir." : "Girdiğiniz bilgiler ve fotoğraflar silinir.", [
      { text: "Vazgeç", style: "cancel" },
      { text: "Sil", style: "destructive", onPress: async () => { await taslakSil(kapsam, id); navigation.goBack(); } },
    ]);
  };

  if (uyarilar) return <OcrUyarilari durum={uyarilar} kategoriKod={alanlar.kategori} onBitti={() => { gecersizKil([`masrafForm:${formId}`, "hesap", "pano"]); navigation.goBack(); }} />;

  return (
    <Ekran
      baslik={kalemKaydedildi ? "Fiş ekle" : "Masraf kalemi"}
      altBaslik={kat?.ad}
      klavye
      sag={doluMu ? (
        <Pressable onPress={taslagiSil} hitSlop={10} accessibilityRole="button" accessibilityLabel="Taslağı sil" style={{ padding: 8 }}>
          <Ionicons name="trash-outline" size={22} color={renk.hata} />
        </Pressable>
      ) : null}
      alt={<Buton baslik={algilaniyor ? "Fiş algılanıyor…" : gonderimHatasi ? "Tekrar dene" : "Kaydet"} ikon={gonderimHatasi ? "refresh" : "checkmark"} onPress={gonder} yukleniyor={gonderiliyor} devreDisi={algilaniyor} />}
    >
      {gonderimHatasi ? <Bant tonAdi="uyari" baslik="Henüz gönderilmedi" metin={gonderimHatasi} style={{ marginBottom: aralik.m }} /> : null}
      {kalemKaydedildi ? <Bant tonAdi="bilgi" metin="Kalem kaydedildi. Bekleyen fiş(ler) gönderilince tamamlanır." style={{ marginBottom: aralik.m }} /> : null}

      <Metin tur="etiket" renk={renk.metinIkincil} style={{ marginBottom: 6 }}>Harcama türü<Metin tur="etiket" renk={renk.hata}> *</Metin></Metin>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: aralik.xs, marginBottom: hatalar.kategori ? 4 : aralik.m }}>
        {MASRAF_KATEGORILERI.map((k) => {
          const sec = alanlar.kategori === k.id;
          return (
            <Pressable key={k.id} onPress={() => !kalemKaydedildi && katSec(k.id)} disabled={kalemKaydedildi} accessibilityRole="radio" accessibilityState={{ selected: sec, disabled: kalemKaydedildi }}
              style={{ width: "31.8%", flexGrow: 1, minHeight: 76, borderRadius: kose.m, borderWidth: sec ? 2 : 1, borderColor: sec ? renk.lacivert : renk.cizgiKoyu,
                backgroundColor: sec ? "#E6ECF4" : renk.yuzey, alignItems: "center", justifyContent: "center", padding: 6, opacity: kalemKaydedildi && !sec ? 0.4 : 1 }}>
              <Ionicons name={k.ikon} size={22} color={sec ? renk.lacivert : renk.metinIkincil} />
              <Metin tur="minik" renk={sec ? renk.lacivert : renk.metin} style={{ textAlign: "center", marginTop: 4, fontWeight: sec ? "700" : "500" }} numberOfLines={2}>{k.ad}</Metin>
            </Pressable>
          );
        })}
      </View>
      {hatalar.kategori ? <Metin tur="minik" renk={renk.hata} style={{ marginBottom: aralik.m }}>{hatalar.kategori}</Metin> : null}

      <View style={{ flexDirection: "row", gap: aralik.s }}>
        <TutarAlani etiket="Tutar" zorunlu deger={alanlar.tutarMetni} onDegis={(v) => set("tutarMetni", v)} hata={hatalar.tutarMetni} style={{ flex: 1 }} editable={!kalemKaydedildi} devreDisi={kalemKaydedildi} />
        <View style={{ flex: 1 }}>
          {kalemKaydedildi ? <Alan etiket="Tarih" deger={tarih(alanlar.tarih) || ""} devreDisi /> : <TarihAlani etiket="Tarih" zorunlu deger={alanlar.tarih} onDegis={(v) => set("tarih", v)} />}
        </View>
      </View>
      {kat?.plaka ? <Alan etiket="Araç plakası" zorunlu={alanlar.kategori === "YAKIT"} deger={alanlar.plaka} onDegis={(v) => set("plaka", v.toUpperCase())} ipucu="16 ABC 123" buyukHarf="characters" hata={hatalar.plaka} devreDisi={kalemKaydedildi} /> : null}
      {kat?.siteId ? <Alan etiket="Site ID" deger={alanlar.siteId} onDegis={(v) => set("siteId", v.toUpperCase())} ipucu="Örn. IZ1234" buyukHarf="characters" devreDisi={kalemKaydedildi} /> : null}
      <Alan etiket="Açıklama" deger={alanlar.aciklama} onDegis={(v) => set("aciklama", v)} ipucu={kat?.aciklamaIpucu || "Kısa açıklama"} devreDisi={kalemKaydedildi} />
      <Alan etiket="Belge açıklaması" deger={alanlar.belgeAciklama} onDegis={(v) => set("belgeAciklama", v)} ipucu={kat?.belgeIpucu || "Fiş / fatura açıklaması"} devreDisi={kalemKaydedildi} />

      <BolumBasligi baslik="Fiş" style={{ marginTop: aralik.xs }} />
      <Kart>
        {fotolar.length ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: aralik.xs, paddingBottom: aralik.s }}>
            {fotolar.map((f, i) => (
              <View key={f.uri} style={{ width: 92 }}>
                <Image source={{ uri: f.onizlemeUri && fotoVarMi(f.onizlemeUri) ? f.onizlemeUri : f.uri }} style={{ width: 92, height: 120, borderRadius: kose.s, backgroundColor: renk.yuzeyIkincil, resizeMode: f.onizlemeUri ? "contain" : "cover" }} accessibilityLabel={`Fiş ${i + 1}`} />
                {f.onIsleme?.durum === "isleniyor" ? (
                  <View style={{ position: "absolute", left: 0, top: 0, width: 92, height: 120, borderRadius: kose.s, backgroundColor: "rgba(15,27,45,0.55)", alignItems: "center", justifyContent: "center" }}>
                    <ActivityIndicator color="#fff" />
                    <Metin tur="minik" renk="#fff" style={{ fontSize: 10, marginTop: 4, textAlign: "center" }}>Fiş algılanıyor…</Metin>
                  </View>
                ) : null}
                {(() => {
                  const r = fisRozeti(f);
                  return (
                    <View style={{ position: "absolute", left: 4, bottom: 4, flexDirection: "row", alignItems: "center", backgroundColor: r.zemin, borderRadius: 10, paddingHorizontal: 6, paddingVertical: 2, maxWidth: 84 }}>
                      <Ionicons name={r.ikon} size={11} color="#fff" />
                      <Metin tur="minik" renk="#fff" style={{ fontSize: 10, marginLeft: 3 }} numberOfLines={1}>{r.metin}</Metin>
                    </View>
                  );
                })()}
                {f.onIsleme?.durum === "hata" && f.durum !== "yuklendi" ? (
                  <Pressable onPress={() => onIsle(f)} hitSlop={6} accessibilityRole="button" accessibilityLabel={`Fiş ${i + 1} kırpmayı tekrar dene`}>
                    <Metin tur="minik" renk={renk.lacivert} style={{ fontSize: 11, marginTop: 4, fontWeight: "700" }}>Kırpmayı dene</Metin>
                  </Pressable>
                ) : null}
                {f.durum !== "yuklendi" ? (
                  <Pressable onPress={() => fotoKaldir(i)} hitSlop={8} accessibilityRole="button" accessibilityLabel={`Fiş ${i + 1} kaldır`}
                    style={{ position: "absolute", right: -6, top: -6, width: 28, height: 28, borderRadius: 14, backgroundColor: renk.yuzey, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: renk.cizgi }}>
                    <Ionicons name="close" size={16} color={renk.metin} />
                  </Pressable>
                ) : null}
              </View>
            ))}
          </ScrollView>
        ) : null}
        {!fissiz.aktif ? (
          <View style={{ flexDirection: "row", gap: aralik.s }}>
            <Buton baslik="Fotoğraf çek" ikon="camera-outline" tur="ikincil" onPress={() => fotoEkle("kamera")} style={{ flex: 1 }} kucuk devreDisi={fotoHazir || algilaniyor} />
            <Buton baslik="Galeriden seç" ikon="images-outline" tur="ikincil" onPress={() => fotoEkle("galeri")} style={{ flex: 1 }} kucuk devreDisi={fotoHazir || algilaniyor} />
          </View>
        ) : null}
        {fotoHazir ? <Metin tur="minik" renk={renk.metinIkincil} style={{ marginTop: aralik.xs }} accessibilityLiveRegion="polite">Fotoğraf hazırlanıyor…</Metin> : null}
        {!fotolar.length ? (
          // Satırın tamamı dokunulabilir (saha kullanımı: küçük anahtar yerine geniş alan)
          <Pressable onPress={fissizDegistir} accessibilityRole="switch" accessibilityState={{ checked: fissiz.aktif }} accessibilityLabel="Fişim yok"
            style={{ flexDirection: "row", alignItems: "center", marginTop: aralik.s, minHeight: 48 }}>
            <Metin tur="kucuk" style={{ flex: 1 }}>Fişim yok</Metin>
            <Switch value={fissiz.aktif} onValueChange={fissizDegistir} trackColor={{ true: renk.lacivert }} importantForAccessibility="no" />
          </Pressable>
        ) : null}
        {fissiz.aktif ? <Alan etiket="Fiş olmamasının nedeni" zorunlu cokSatir deger={fissiz.aciklama} onDegis={(v) => { setFissiz((s) => ({ ...s, aciklama: v })); setHatalar((h) => ({ ...h, fissizAciklama: null })); }}
          ipucu="Örn. köprü geçişi HGS'den, fiş verilmedi" hata={hatalar.fissizAciklama} style={{ marginTop: aralik.s, marginBottom: 0 }} /> : null}
        {hatalar.fis ? <Metin tur="minik" renk={renk.hata} style={{ marginTop: aralik.xs }}>{hatalar.fis}</Metin> : null}
      </Kart>
      <Metin tur="minik" renk={renk.metinSoluk} style={{ marginTop: aralik.xs }}>
        Fiş eklenince otomatik bulunup kırpılır, onayınıza sunulur; "Kaydet" ile gönderilir. Fiş düz bir zeminde, tamamı görünecek şekilde çekilmelidir.
      </Metin>

      <KirpmaSecimi durum={kirpma} kapat={(secim) => { kirpma?.coz(secim); setKirpma(null); }} />
      {/* Kırpma onay ekranı açıkken gizlenir (iki pencere üst üste açılmaz) */}
      <GonderimIlerlemesi gorunur={gonderiliyor && !kirpma} asama={asama} baslangic={baslangic} />
    </Ekran>
  );
}

// ── Gönderim ilerlemesi (04.11.2026) ─────────────────────────────────────────────────────────────────────────────
// Adım adım ne yapıldığı + geçen süre; bir adım 15 sn'yi geçince "uygulamayı kapatmayın" notu. Tam ekran ve dokunmaya kapalı:
// ikinci dokunuş / geri gitme olmaz (Android geri tuşu uyarı verir). Fiş işleme tek istektir (yükleme + otomatik kırpma):
// ilk saniyeler "yükleniyor", sonrası "bulunuyor" yazılır.
const ASAMA_METNI = {
  kalem: () => "Kalem kaydediliyor…",
  fis_isleme: (sn) => (sn < 4 ? "Fiş yükleniyor…" : "Fiş bulunuyor (yaklaşık 20 sn)…"),
  kirpma_onay: () => "Kırpma onayı bekleniyor…",
  okuma: () => "Tutar ve plaka okunuyor…",
  fis_yukleme: () => "Fiş yükleniyor ve okunuyor…",
  fissiz: () => "Fişsiz kalem bilgisi kaydediliyor…",
  bitti: () => "Tamamlandı",
};
const ADIMLAR = [["kalem", "Kalem kaydı"], ["fis", "Fiş yükleme ve bulma"], ["okuma", "Tutar ve plaka okuma"]];
const adimGrubu = (kod) => (kod === "kalem" ? 0 : kod === "fis_isleme" || kod === "kirpma_onay" || kod === "fis_yukleme" ? 1 : kod === "okuma" ? 2 : kod === "bitti" || kod === "fissiz" ? 3 : -1);

export function GonderimIlerlemesi({ gorunur, asama, baslangic }) {
  const [simdi, setSimdi] = useState(Date.now());
  // iOS: bir Modal kapanırken (kırpma onayı) yenisi açılamaz, sessizce görünmez kalır → açılış kısa gecikmeyle
  const [acik, setAcik] = useState(false);
  useEffect(() => {
    if (!gorunur) { setAcik(false); return undefined; }
    const t = setTimeout(() => setAcik(true), 450);
    return () => clearTimeout(t);
  }, [gorunur]);
  useEffect(() => {
    if (!gorunur) return undefined;
    setSimdi(Date.now());
    const z = setInterval(() => setSimdi(Date.now()), 1000);
    return () => clearInterval(z);
  }, [gorunur]);
  if (!gorunur || !acik) return null;
  const adimSn = Math.max(0, Math.floor((simdi - (asama?.t || baslangic || simdi)) / 1000));
  const toplamSn = Math.max(0, Math.floor((simdi - (baslangic || simdi)) / 1000));
  const metin = asama ? (ASAMA_METNI[asama.kod] || (() => "İşleniyor…"))(adimSn) : "Hazırlanıyor…";
  const grup = asama ? adimGrubu(asama.kod) : -1;
  return (
    <Modal visible transparent animationType="fade" statusBarTranslucent
      onRequestClose={() => Alert.alert("Kayıt sürüyor", "Lütfen bitmesini bekleyin. Bilgileriniz telefonda saklı.")}>
      <View style={{ flex: 1, backgroundColor: "rgba(15,27,45,0.55)", alignItems: "center", justifyContent: "center", padding: aralik.l }}>
        <View accessibilityLiveRegion="polite" accessibilityLabel={`${metin}${asama?.toplam > 1 ? `, fiş ${asama.sira} / ${asama.toplam}` : ""}, ${toplamSn} saniye`}
          style={{ width: "100%", maxWidth: 380, backgroundColor: renk.yuzey, borderRadius: kose.l, padding: aralik.l }}>
          <View style={{ flexDirection: "row", alignItems: "center" }}>
            <ActivityIndicator size="large" color={renk.lacivert} />
            <View style={{ marginLeft: aralik.m, flex: 1 }}>
              <Metin tur="baslikM">{metin}</Metin>
              {asama?.toplam > 1 ? <Metin tur="kucukKalin" renk={renk.lacivert} style={{ marginTop: 2 }}>Fiş {asama.sira} / {asama.toplam}</Metin> : null}
            </View>
          </View>
          <View style={{ marginTop: aralik.m }}>
            {ADIMLAR.map(([kod, ad], i) => {
              const bitti = grup > i, simdiki = grup === i;
              return (
                <View key={kod} style={{ flexDirection: "row", alignItems: "center", paddingVertical: 4 }}>
                  <Ionicons name={bitti ? "checkmark-circle" : simdiki ? "ellipse" : "ellipse-outline"} size={18} color={bitti ? renk.basari : simdiki ? renk.lacivert : renk.metinSoluk} />
                  <Metin tur="kucuk" renk={bitti || simdiki ? renk.metin : renk.metinSoluk} style={{ marginLeft: aralik.xs, fontWeight: simdiki ? "700" : "400" }}>{ad}</Metin>
                </View>
              );
            })}
          </View>
          <Metin tur="minik" renk={renk.metinIkincil} style={{ marginTop: aralik.s }}>Geçen süre: {toplamSn} sn</Metin>
          {adimSn >= 15 ? <Bant tonAdi="bilgi" metin="İşlem sürüyor, uygulamayı kapatmayın — kaydınız telefonda saklı." style={{ marginTop: aralik.s }} /> : null}
        </View>
      </View>
    </Modal>
  );
}

// Sunucunun ham mesajı (ör. yapılandırma hatası) gösterilmez; durum koduna göre sade metin
const KIRPMA_MESAJ = {
  GUVENILIR: "Fiş algılandı ve otomatik kırpıldı. Uygunsa ekleyin.",
  KONTROL: "Fiş algılandı; kırpmanın doğru olup olmadığına bakın.",
  COKLU: "Fotoğrafta birden fazla fiş bulundu. Bu kaleme ait olanları seçin.",
  FIS_YOK: "Fotoğrafta fiş algılanamadı. Fişi düz bir zemine koyup yeniden çekin ya da köşeleri elle işaretleyin.",
  AI_HATA: "Otomatik kırpma şu an yapılamadı. Köşeleri elle işaretleyebilir, yeniden çekebilir ya da fotoğrafı olduğu gibi ekleyebilirsiniz.",
};

// Küçük önizleme rozeti: gönderildi / algılanıyor / kırpıldı / köşeler düzeltildi / kırpmadan (kullanıcı seçimi) / kırpılamadı
function fisRozeti(f) {
  if (f.durum === "yuklendi") return { metin: "Gönderildi", ikon: "checkmark", zemin: renk.basari };
  const o = f.onIsleme;
  if (o?.durum === "isleniyor") return { metin: "Algılanıyor", ikon: "scan-outline", zemin: "rgba(15,27,45,0.75)" };
  if (o?.durum === "onaylandi") {
    if (o.tur === "kirpmadan") return { metin: "Kırpmadan", ikon: "image-outline", zemin: "rgba(15,27,45,0.75)" };
    if (o.tur === "duzeltildi") return { metin: "Düzeltildi", ikon: "crop-outline", zemin: renk.lacivert };
    return { metin: o.adet > 1 ? `${o.adet} fiş` : "Kırpıldı", ikon: "crop-outline", zemin: renk.lacivert };
  }
  if (o?.durum === "kirpmadan" || f.kirpmadanOnay) return { metin: "Kırpmadan", ikon: "image-outline", zemin: "rgba(15,27,45,0.75)" };
  if (o?.durum === "hata") return { metin: "Kırpılamadı", ikon: "alert-circle-outline", zemin: renk.uyari };
  return { metin: "Telefonda", ikon: "phone-portrait-outline", zemin: "rgba(15,27,45,0.75)" };
}

// Otomatik kırpma sonucu: önerilen kırpma(lar)ı ekle, köşeleri elle düzelt, elle kırp, orijinali ekle ya da yeniden çek.
// Düzeltilen köşeler sunucuya gider; kırpmayı sunucu orijinal fotoğraftan yapar (kirpma_durum = KULLANICI).
// Köşe düzenleyici bu Modal'ın içinde katman olarak açılır (iOS aynı anda iki Modal göstermiyor).
function KirpmaSecimi({ durum, kapat }) {
  const { bottom: alt, top: ust } = useSafeAreaInsets();
  const [secili, setSecili] = useState([]);
  const [duzelt, setDuzelt] = useState(null); // { aday } | { aday: null } (elle kırp)
  const y = durum?.yanit;
  useEffect(() => { setSecili((y?.adaylar || []).length === 1 ? [y.adaylar[0].no] : []); setDuzelt(null); }, [y]);
  if (!durum) return null;
  const adaylar = y.adaylar || [];
  const coklu = adaylar.length > 1;
  const kontrol = y.durum === "KONTROL" || adaylar.some((a) => a.guvenilir === false);
  const fisYok = !adaylar.length;
  const degistir = (no) => setSecili((s) => (s.includes(no) ? s.filter((x) => x !== no) : [...s, no]));
  const kaynakUri = y.kaynak?.onizleme || durum.foto.uri;

  return (
    <Modal visible animationType="slide" presentationStyle="fullScreen" onRequestClose={() => (duzelt ? setDuzelt(null) : kapat(null))}>
      {duzelt ? (
        <KoseDuzenleyici
          uri={kaynakUri}
          olcu={y.olcu}
          baslangic={duzelt.aday?.kose || y.elle_baslangic}
          baslik={duzelt.aday ? "Kırpmayı düzelt" : "Elle kırp"}
          onIptal={() => setDuzelt(null)}
          onTamam={(kose) => kapat([{ ...(duzelt.aday ? { aday_no: duzelt.aday.no } : {}), kose }])}
        />
      ) : (
        <View style={{ flex: 1, backgroundColor: renk.zemin }}>
          <View style={{ padding: aralik.m, paddingTop: ust + aralik.s, backgroundColor: renk.yuzey }}>
            <Metin tur="baslikM" style={{ fontWeight: "700" }} accessibilityRole="header">Fişi kontrol edin</Metin>
            <Metin tur="kucuk" renk={renk.metinIkincil} style={{ marginTop: 4 }}>{KIRPMA_MESAJ[y.durum] || "Fişi kontrol edip ekleyin."}</Metin>
          </View>
          <ScrollView contentContainerStyle={{ padding: aralik.m, gap: aralik.s }}>
            {adaylar.map((a) => {
              const sec = secili.includes(a.no);
              return (
                <View key={a.no} style={{ borderRadius: kose.l, borderWidth: 2, borderColor: sec ? renk.lacivert : renk.cizgi, backgroundColor: renk.yuzey, padding: aralik.s }}>
                  <Pressable onPress={() => coklu && degistir(a.no)} accessibilityRole={coklu ? "checkbox" : undefined} accessibilityState={coklu ? { checked: sec } : undefined}>
                    <Image source={{ uri: a.onizleme }} style={{ width: "100%", height: coklu ? 260 : 340, resizeMode: "contain" }} accessibilityLabel={`Kırpılmış fiş ${a.no}`} />
                    {coklu ? (
                      <View style={{ flexDirection: "row", alignItems: "center", marginTop: aralik.xs }}>
                        <Ionicons name={sec ? "checkbox" : "square-outline"} size={22} color={renk.lacivert} />
                        <Metin tur="kucukKalin" style={{ marginLeft: 6, flex: 1 }}>Fiş {a.no}</Metin>
                      </View>
                    ) : null}
                  </Pressable>
                  {(a.uyarilar || []).map((u, i) => (
                    <View key={i} style={{ flexDirection: "row", marginTop: 6 }}>
                      <Ionicons name="warning-outline" size={16} color={renk.uyari} style={{ marginRight: 6, marginTop: 1 }} />
                      <Metin tur="kucuk" renk={renk.uyari} style={{ flex: 1 }}>{u}</Metin>
                    </View>
                  ))}
                  <Buton baslik="Kırpmayı düzelt" ikon="crop-outline" tur="ikincil" kucuk onPress={() => setDuzelt({ aday: a })} style={{ marginTop: aralik.s }} />
                </View>
              );
            })}
            {fisYok ? (
              <Image source={{ uri: kaynakUri }} style={{ width: "100%", height: 380, resizeMode: "contain", borderRadius: kose.l }} accessibilityLabel="Orijinal fotoğraf" />
            ) : null}
          </ScrollView>
          <View style={{ padding: aralik.m, paddingBottom: alt + aralik.s, backgroundColor: renk.yuzey, gap: aralik.xs }}>
            {fisYok ? (
              <Buton baslik="Elle kırp" ikon="crop-outline" onPress={() => setDuzelt({ aday: null })} />
            ) : coklu ? (
              <Buton baslik={secili.length ? `Seçilen ${secili.length} fişi ekle` : "Eklenecek fişleri seçin"} devreDisi={!secili.length}
                onPress={() => kapat(secili.slice().sort((p, q) => p - q).map((no) => ({ aday_no: no })))} />
            ) : kontrol ? (
              <>
                <Buton baslik="Kırpmayı düzelt" ikon="crop-outline" onPress={() => setDuzelt({ aday: adaylar[0] })} />
                <Buton baslik="Uyarıya rağmen bu haliyle ekle" tur="ikincil" onPress={() => kapat([{ aday_no: adaylar[0].no }])} />
              </>
            ) : (
              <>
                <Buton baslik="Kırpmayı kullan" ikon="checkmark" onPress={() => kapat([{ aday_no: adaylar[0].no }])} />
                <Buton baslik="Köşeleri düzelt" ikon="crop-outline" tur="ikincil" onPress={() => setDuzelt({ aday: adaylar[0] })} />
              </>
            )}
            <View style={{ flexDirection: "row", gap: aralik.xs }}>
              <Buton baslik="Yeniden çek" ikon="camera-outline" tur="ikincil" kucuk onPress={() => kapat({ yenidenCek: true })} style={{ flex: 1 }} />
              {/* 06.11.2026: kırpmasız kullanım her durumda AÇIK kullanıcı seçimi olarak sunulur (sunucu KIRPILMADI kaydeder) */}
              <Buton baslik="Kırpmadan kullan" tur="ikincil" kucuk onPress={() => kapat([{ kirpma: "yok" }])} style={{ flex: 1 }} />
            </View>
            <Buton baslik="Vazgeç" tur="metin" kucuk onPress={() => kapat(null)} />
          </View>
        </View>
      )}
    </Modal>
  );
}

// Fişten okunan tutar / plaka girilenle uyuşmazsa (mevcut iş kuralı: tutar farkı açıklanır, yanlış plakalı fiş kaldırılır)
function OcrUyarilari({ durum, kategoriKod, onBitti }) {
  const [sira, setSira] = useState(0);
  const [aciklama, setAciklama] = useState("");
  const [bekle, setBekle] = useState(false);
  const u = durum.liste[sira];
  const sonraki = () => { setAciklama(""); if (sira + 1 < durum.liste.length) setSira(sira + 1); else onBitti(); };
  const calistir = async (is) => {
    setBekle(true);
    try { await is(); sonraki(); } catch (e) { Alert.alert("Kaydedilemedi", hataMetni(e)); } finally { setBekle(false); }
  };
  return (
    <Ekran baslik="Fiş kontrolü" geri={false}>
      <Bant tonAdi="basari" metin="Kalem ve fiş kaydedildi." style={{ marginBottom: aralik.m }} />
      {u.tur === "tutar" ? (
        <Kart>
          <Metin tur="govdeKalin">Fişteki tutar farklı görünüyor</Metin>
          <Metin tur="kucuk" renk={renk.metinIkincil} style={{ marginTop: 4 }}>
            Fişten okunan: <Metin tur="kucukKalin" style={yazi.tutar}>{tl(u.ocr)}</Metin> · Girdiğiniz: <Metin tur="kucukKalin" style={yazi.tutar}>{tl(durum.girilen)}</Metin>
          </Metin>
          <Alan etiket="Farkın nedeni" cokSatir deger={aciklama} onDegis={setAciklama} ipucu="Örn. fişte iki kişilik tutar var, yarısı benim" style={{ marginTop: aralik.m }} />
          <Buton baslik="Açıklamayı kaydet" yukleniyor={bekle} devreDisi={!aciklama.trim()}
            onPress={() => calistir(() => masrafApi.kalemGuncelle(durum.kalemId, { tutar_uyari_aciklama: aciklama.trim() }))} />
          <Buton baslik={`Fişteki tutarı kullan (${tl(u.ocr)})`} tur="ikincil" style={{ marginTop: aralik.xs }} devreDisi={bekle}
            onPress={() => calistir(() => masrafApi.kalemGuncelle(durum.kalemId, { tutar: u.ocr }))} />
        </Kart>
      ) : (
        <Kart>
          <Metin tur="govdeKalin">Fişteki plaka eşleşmedi</Metin>
          <Metin tur="kucuk" renk={renk.metinIkincil} style={{ marginTop: 4 }}>
            Fişte okunan plaka ({u.plaka}) kaleme girdiğiniz plakayla aynı değil{kategoriKod === "YAKIT" ? ". Yakıt fişi doğru araca ait olmalı" : ""}. Bu fiş kaldırılacak; doğru fişi ekleyin.
          </Metin>
          <Buton baslik="Fişi kaldır" tur="tehlike" yukleniyor={bekle} style={{ marginTop: aralik.m }} onPress={() => calistir(() => masrafApi.belgeSil(u.belgeId))} />
        </Kart>
      )}
    </Ekran>
  );
}
