// Masraf kalemi ekleme + fiş. Girilen her şey yazarken telefona kaydedilir (taslak); bağlantı koparsa
// form ve fotoğraflar kaybolmaz, "Gönderildi" görünmez; tekrar denemede kalınan adımdan devam edilir.
import React, { useCallback, useEffect, useRef, useState } from "react";
import { Alert, Image, Linking, Modal, Pressable, ScrollView, Switch, View } from "react-native";
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
import { fotoSil, fotoVarMi, taslak as taslakOku, taslakKaydet, taslakSil, yeniKimlik } from "../taslak/taslakDepo";
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
        setFotolar((t.fotolar || []).filter((f) => f.durum === "yuklendi" || fotoVarMi(f.uri)));
        setFissiz(t.fissiz || { aktif: false, aciklama: "" });
        setKayitli(t);
        setGonderimHatasi(t.gonderimHatasi || null);
      }
      yuklendi.current = true;
    });
  }, [kapsam, taslakId]);

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
        fotolar: fotolar.map((f) => ({ uri: f.uri, ad: f.ad, mime: f.mime, boyut: f.boyut })), // durum alanları depoda birleştirilir
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

  const fotoEkle = async (kaynak) => {
    if (fotoHazir) return;
    setFotoHazir(true);
    try {
      const f = await fisSec(kaynak, kapsam);
      if (!f) return; // vazgeçildi
      setFotolar((l) => [...l, { ...f, durum: "bekliyor" }]);
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
  };

  const fotoKaldir = (i) => {
    const f = fotolar[i];
    if (f.durum === "yuklendi") return; // sunucuya gitmiş fiş buradan silinmez
    fotoSil(f.uri);
    setFotolar((l) => l.filter((_, j) => j !== i));
  };

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
    const tutar = dogrula();
    if (!tutar) return;
    kilit.current = true;
    if (otoKayit.current) { clearTimeout(otoKayit.current); otoKayit.current = null; }
    setGonderiliyor(true);
    setGonderimHatasi(null);
    try {
      // Telefondaki son adım bilgisi (kalemId, fotoğrafların denenme durumu) korunur; yalnız alanlar güncellenir
      const once = (await taslakOku(kapsam, id)) || {};
      const temel = await taslakKaydet(kapsam, {
        id, tur: "masrafKalem", formId, alanlarHam: alanlar, fissiz, gonderimHatasi: null, ...sabitAdim(once.adim),
        fotolar: fotolar.map((f) => ({ ...f, ...(once.fotolar || []).find((x) => x.uri === f.uri) })),
        alanlar: { ...alanlar, tutar },
      });
      const sonuc = await kalemGonder({
        taslak: temel,
        kaydet: async (t) => { const y = await taslakKaydet(kapsam, t); setKayitli(y); setFotolar(y.fotolar); return y; },
        api: masrafApi,
        kirpmaSec,
        kimlik: () => yeniKimlik().replace(/-/g, ""),
        fotoVarMi,
      });
      gecersizKil([`masrafForm:${formId}`, "masrafFormlar", "hesap", "pano"]);
      if (sonuc.yenidenCek) {
        kilit.current = false;
        setGonderiliyor(false);
        await yenidenCek(sonuc.yenidenCek);
        return;
      }
      if (sonuc.yarim) {
        setGonderimHatasi("Fiş ekleme yarıda kaldı. Kalem kaydedildi; fişi eklemek için tekrar 'Kaydet'e dokunun.");
        return;
      }
      await taslakSil(kapsam, id);
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
      setGonderiliyor(false);
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
      alt={<Buton baslik={gonderimHatasi ? "Tekrar dene" : "Kaydet"} ikon={gonderimHatasi ? "refresh" : "checkmark"} onPress={gonder} yukleniyor={gonderiliyor} />}
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
                <Image source={{ uri: f.uri }} style={{ width: 92, height: 120, borderRadius: kose.s, backgroundColor: renk.yuzeyIkincil }} accessibilityLabel={`Fiş ${i + 1}`} />
                <View style={{ position: "absolute", left: 4, bottom: 4, flexDirection: "row", alignItems: "center", backgroundColor: f.durum === "yuklendi" ? renk.basari : "rgba(15,27,45,0.75)", borderRadius: 10, paddingHorizontal: 6, paddingVertical: 2 }}>
                  <Ionicons name={f.durum === "yuklendi" ? "checkmark" : "phone-portrait-outline"} size={11} color="#fff" />
                  <Metin tur="minik" renk="#fff" style={{ fontSize: 10, marginLeft: 3 }}>{f.durum === "yuklendi" ? "Gönderildi" : "Telefonda"}</Metin>
                </View>
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
            <Buton baslik="Fotoğraf çek" ikon="camera-outline" tur="ikincil" onPress={() => fotoEkle("kamera")} style={{ flex: 1 }} kucuk devreDisi={fotoHazir} />
            <Buton baslik="Galeriden seç" ikon="images-outline" tur="ikincil" onPress={() => fotoEkle("galeri")} style={{ flex: 1 }} kucuk devreDisi={fotoHazir} />
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
        Fotoğraf telefonda saklanır ve "Kaydet" ile gönderilir. Fiş düz bir zeminde, tamamı görünecek şekilde çekilmelidir.
      </Metin>

      <KirpmaSecimi durum={kirpma} kapat={(secim) => { kirpma?.coz(secim); setKirpma(null); }} />
    </Ekran>
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
              <Buton baslik="Kırpılmış fişi ekle" ikon="checkmark" onPress={() => kapat([{ aday_no: adaylar[0].no }])} />
            )}
            <View style={{ flexDirection: "row", gap: aralik.xs }}>
              <Buton baslik="Yeniden çek" ikon="camera-outline" tur="ikincil" kucuk onPress={() => kapat({ yenidenCek: true })} style={{ flex: 1 }} />
              {fisYok ? <Buton baslik="Kırpmadan ekle" tur="ikincil" kucuk onPress={() => kapat([{ kirpma: "yok" }])} style={{ flex: 1 }} /> : null}
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
