// Şirket sahibi / yönetici deneyimi: şirket özeti, onay bekleyenler, Personel Yönetimi ve Personel Detayı.
// Kapsam ve maaş yetkisi backend'de (/yonetim/*): yalnız kullanıcının kendi firması; maaş yetkisi yoksa alan yanıtta HİÇ yoktur.
// Bu profilde kişisel puantaj/mesai/devamsızlık kartı gösterilmez; kişinin kendi avans/masraf hareketi varsa "Kişisel hesabım" kalır.
import React, { useCallback, useEffect, useRef, useState } from "react";
import { FlatList, Pressable, RefreshControl, ScrollView, StatusBar, View } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { aralik, kose, renk, yazi } from "../tema";
import { BilgiSatiri, BolumBasligi, Kart, Metin, Rozet, IkonKutu } from "../bilesenler/temel";
import { Bant, BosDurum, EskiVeriBandi, HataDurum, IskeletKart } from "../bilesenler/durum";
import { Alan, CipSecim } from "../bilesenler/form";
import { Ekran } from "../bilesenler/Ekran";
import { FirmaBasligi } from "../bilesenler/marka";
import { BaglantiBandi } from "../bilesenler/BaglantiBandi";
import { useOturum } from "../oturum/OturumSaglayici";
import { useVeri } from "../api/veri";
import { cleanupApi, onayApi, panoApi, yonetimApi } from "../api/uclar";
import { firmaKimligi } from "../mantik/kapsam";
import { profilAdi } from "../mantik/profil";
import { durumBilgisi, rolAdi } from "../mantik/durumlar";
import { ayAdi, basHarfler, donem as donemAdi, tarih, tarihUzun, tl } from "../mantik/bicim";

export function YonetimAnaSayfa({ navigation }) {
  const { kullanici } = useOturum();
  const kenar = useSafeAreaInsets();
  const firma = firmaKimligi(kullanici);
  const ozet = useVeri("yonetimOzet", () => yonetimApi.ozet());
  // Onayınızı bekleyen işlemler: /onay/bekleyen (firma + tarihli devir backend'de); Clean Up bölge onayı ayrı uçtan
  const onay = useVeri("onayBekleyen", () => onayApi.bekleyen());
  const cleanup = useVeri("cleanupOnay", () => cleanupApi.onayBekleyen());
  const hesap = useVeri("hesap", () => panoApi.hesap());
  useFocusEffect(useCallback(() => { StatusBar.setBarStyle("light-content", true); }, []));
  const o = ozet.veri;
  const ad = String(kullanici?.name || "").split(" ")[0] || "";
  const onayci = !!kullanici?.onay?.onayci || !!onay.veri?.onayci || !!cleanup.veri?.yetkili;
  const onayAdedi = (onay.veri?.sayac || 0) + (cleanup.veri?.rows?.length || 0);
  const planli = (onay.veri?.planli || kullanici?.onay?.planli || []).filter((p) => !(onay.veri?.devirler || kullanici?.onay?.devirler || []).some((d) => d.firma === p.firma && d.adim === p.adim));
  // Kişisel hesap yalnız gerçekten hareket ya da bekleyen kayıt varsa (şirket sahibi için otomatik personel/puantaj kaydı yok)
  const kisiselVar = !!(hesap.veri && ((hesap.veri.hareketler || []).length || (hesap.veri.bekleyen?.avanslar || []).length || (hesap.veri.bekleyen?.formlar || []).length));
  const sayi = (n) => (n === null || n === undefined ? "—" : String(n));
  const yenile = () => { ozet.yenile(); onay.yenile(); cleanup.yenile(); hesap.yenile(); };
  return (
    <View style={{ flex: 1, backgroundColor: renk.zemin }}>
      <ScrollView contentContainerStyle={{ paddingBottom: aralik.xxl }}
        refreshControl={<RefreshControl refreshing={ozet.yenileniyor || onay.yenileniyor} onRefresh={yenile} tintColor="#fff" />}>
        <View style={{ backgroundColor: renk.lacivert, paddingTop: kenar.top + aralik.xs, paddingHorizontal: aralik.m, paddingBottom: 64 }}>
          <View style={{ flexDirection: "row", alignItems: "center" }}>
            <FirmaBasligi firma={firma} />
            <Pressable onPress={() => navigation.navigate("Profil")} accessibilityRole="button" accessibilityLabel="Profil ve çıkış"
              style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: "rgba(255,255,255,0.14)", alignItems: "center", justifyContent: "center", marginLeft: aralik.s }}>
              <Metin tur="kucukKalin" renk="#fff">{basHarfler(kullanici?.name)}</Metin>
            </Pressable>
          </View>
          <Metin tur="baslikXL" renk="#fff" style={{ marginTop: aralik.l }} numberOfLines={1}>Merhaba{ad ? `, ${ad}` : ""}</Metin>
          <Metin tur="kucuk" renk="#C7D3E3" numberOfLines={1}>{[profilAdi(kullanici) || rolAdi(kullanici?.role), o?.firma?.ad || kullanici?.marka_ad].filter(Boolean).join(" · ")}</Metin>
        </View>
        <BaglantiBandi />
        <View style={{ paddingHorizontal: aralik.m, marginTop: -48 }}>
          {/* 1) Onayınızı bekleyen işlemler — onaycıda kalıcı kart; bekleyen yokken de anlaşılır boş durum */}
          {onayci ? (
            <Kart onPress={() => navigation.navigate("Onaylar")} erisimEtiketi={onayAdedi ? `${onayAdedi} kayıt onayınızı bekliyor` : "Onaylar: bekleyen işlem yok"}>
              <View style={{ flexDirection: "row", alignItems: "center" }}>
                <IkonKutu ad="checkmark-done-outline" tonAdi={onayAdedi ? "uyari" : "basari"} boyut={48} />
                <View style={{ flex: 1, marginLeft: aralik.s }}>
                  <Metin tur="etiket" renk={renk.metinIkincil} style={{ textTransform: "uppercase", letterSpacing: 0.6 }}>Onayınızı bekleyen işlemler</Metin>
                  {onay.hata && !onay.veri ? <Metin tur="govdeKalin" renk={renk.uyari}>Liste alınamadı · tekrar deneyin</Metin>
                    : onay.yukleniyor && !onay.veri ? <Metin tur="govdeKalin" renk={renk.metinSoluk}>Yükleniyor…</Metin>
                    : <Metin tur="baslikL" style={yazi.tutar} renk={onayAdedi ? renk.uyari : renk.metin}>{onayAdedi ? `${onayAdedi} kayıt` : "Bekleyen işlem yok"}</Metin>}
                  <Metin tur="kucuk" renk={renk.metinIkincil} numberOfLines={2}>
                    {[(onay.veri?.kategoriler?.avans?.rows?.length || 0) ? `${onay.veri.kategoriler.avans.rows.length} iş avansı` : null,
                      (onay.veri?.kategoriler?.masraf?.rows?.length || 0) ? `${onay.veri.kategoriler.masraf.rows.length} masraf formu` : null,
                      (onay.veri?.kategoriler?.malzeme?.rows?.length || 0) ? `${onay.veri.kategoriler.malzeme.rows.length} malzeme talebi` : null,
                      (cleanup.veri?.rows?.length || 0) ? `${cleanup.veri.rows.length} Clean Up` : null].filter(Boolean).join(" · ") || "İş avansı, masraf formu ve malzeme talepleri"}
                  </Metin>
                </View>
                <Ionicons name="chevron-forward" size={20} color={renk.metinSoluk} />
              </View>
              {(onay.veri?.yapilandirma_hatasi || []).length ? <Bant tonAdi="uyari" ikon="warning-outline" metin={onay.veri.yapilandirma_hatasi[0]} style={{ marginTop: aralik.s }} /> : null}
            </Kart>
          ) : null}
          {planli.map((p) => (
            <Bant key={`${p.firma}-${p.adim}`} tonAdi="bilgi" ikon="calendar-outline" style={{ marginTop: aralik.s }}
              metin={`${p.adim_ad} yetkiniz ${tarihUzun(p.baslangic)} itibarıyla başlıyor.`} />
          ))}

          {/* 2) Personel Yönetimi — belirgin düğme */}
          <Kart style={{ marginTop: aralik.s, borderWidth: 1, borderColor: renk.lacivertAcik }} onPress={() => navigation.navigate("PersonelYonetimi")} erisimEtiketi="Personel Yönetimi: personel ara, seç ve bilgilerini incele">
            <View style={{ flexDirection: "row", alignItems: "center" }}>
              <IkonKutu ad="people-outline" boyut={48} />
              <View style={{ flex: 1, marginLeft: aralik.s }}>
                <Metin tur="baslikM" style={{ fontWeight: "700" }}>Personel Yönetimi</Metin>
                <Metin tur="kucuk" renk={renk.metinIkincil}>Personel ara, seç; hesap, maaş, puantaj, saha ve zimmet bilgilerini incele</Metin>
              </View>
              <Ionicons name="chevron-forward" size={20} color={renk.lacivert} />
            </View>
          </Kart>

          {/* 3) Saha ve iş durumu */}
          <BolumBasligi baslik="Saha ve iş durumu" />
          <Kart onPress={() => navigation.navigate("Saha")} erisimEtiketi="Saha işleri">
            <View style={{ flexDirection: "row", alignItems: "center" }}>
              <IkonKutu ad="navigate-outline" />
              <View style={{ flex: 1, marginLeft: aralik.s }}>
                <Metin tur="govdeKalin">{o?.saha?.acik_is !== null && o?.saha?.acik_is !== undefined ? `${o.saha.acik_is} açık saha işi` : "Saha işleri ve Clean Up"}</Metin>
                <Metin tur="kucuk" renk={renk.metinIkincil}>Atanan işler, Clean Up, malzeme ve zimmet</Metin>
              </View>
              <Ionicons name="chevron-forward" size={18} color={renk.metinSoluk} />
            </View>
          </Kart>

          {/* 4) Yetki dahilindeki şirket özeti */}
          <BolumBasligi baslik="Şirket özeti" />
          {ozet.yukleniyor && !o ? <IskeletKart yukseklik={120} /> : null}
          {ozet.hata && !o ? <Kart><HataDurum hata={ozet.hata} baslik="Şirket özeti alınamadı" onTekrar={ozet.yenile} /></Kart> : null}
          {o ? (
            <Kart>
              <EskiVeriBandi v={ozet} style={{ marginBottom: aralik.xs }} />
              <View style={{ flexDirection: "row" }}>
                <OzetKutu deger={sayi(o.personel?.aktif)} etiket="Aktif personel" />
                <OzetKutu deger={sayi(o.saha?.acik_is)} etiket="Açık saha işi" />
                <OzetKutu deger={sayi(o.onay_bekleyen?.avans?.adet)} etiket="Onayda avans" renk={o.onay_bekleyen?.avans?.adet ? renk.uyari : undefined} />
                <OzetKutu deger={sayi(o.onay_bekleyen?.masraf?.adet)} etiket="Onayda masraf" renk={o.onay_bekleyen?.masraf?.adet ? renk.uyari : undefined} />
              </View>
              {o.onay_bekleyen?.avans?.tutar ? <Metin tur="minik" renk={renk.metinSoluk} style={{ marginTop: aralik.xs }}>Onay bekleyen iş avansı toplamı: {tl(o.onay_bekleyen.avans.tutar)} (tüm adımlar)</Metin> : null}
            </Kart>
          ) : null}

          {kisiselVar ? (
            <>
              <BolumBasligi baslik="Kişisel işlemlerim" />
              <Kart onPress={() => navigation.navigate("HesapHareketleri")} erisimEtiketi="Kişisel avans ve masraf hareketleri">
                <Metin tur="govdeKalin">Kendi iş avansı ve masraf hareketleriniz</Metin>
                <Metin tur="kucuk" renk={renk.metinIkincil}>Bakiye: {tl(hesap.veri?.ozet?.bakiye) ?? "—"}{hesap.hata ? " · güncellenemedi" : ""}</Metin>
              </Kart>
            </>
          ) : null}
        </View>
      </ScrollView>
      <View pointerEvents="none" style={{ position: "absolute", top: 0, left: 0, right: 0, height: kenar.top, backgroundColor: renk.lacivert }} />
    </View>
  );
}

function OzetKutu({ deger, etiket, renk: r }) {
  return (
    <View style={{ flex: 1, alignItems: "center" }} accessible accessibilityLabel={`${etiket}: ${deger}`}>
      <Metin tur="baslikL" renk={r || renk.metin} style={yazi.tutar}>{deger}</Metin>
      <Metin tur="minik" renk={renk.metinIkincil} style={{ textAlign: "center" }}>{etiket}</Metin>
    </View>
  );
}

// ── Personel Yönetimi: arama, aktif/pasif, bölge, ekip; sayfalı liste ─────────────────────────────
export function PersonelYonetimiEkrani({ navigation }) {
  const [q, setQ] = useState("");
  const [aktif, setAktif] = useState("1");
  const [bolge, setBolge] = useState("");
  const [ekip, setEkip] = useState("");
  const [satirlar, setSatirlar] = useState([]);
  const [meta, setMeta] = useState({ toplam: null, sayfa: 1, filtreler: null });
  const [durum, setDurum] = useState({ yukleniyor: true, hata: null, ek: false });
  const sira = useRef(0);

  const yukle = useCallback(async (sayfa = 1) => {
    const benim = ++sira.current;
    setDurum((d) => ({ ...d, yukleniyor: sayfa === 1, ek: sayfa > 1, hata: null }));
    try {
      const r = await yonetimApi.personel({ q, aktif, bolge, ekip, sayfa });
      if (benim !== sira.current) return;
      setSatirlar((s) => (sayfa === 1 ? r.rows : [...s, ...r.rows]));
      setMeta({ toplam: r.toplam, sayfa: r.sayfa, limit: r.limit, filtreler: r.filtreler });
      setDurum({ yukleniyor: false, hata: null, ek: false });
    } catch (e) {
      if (benim !== sira.current) return;
      setDurum({ yukleniyor: false, hata: e, ek: false });
    }
  }, [q, aktif, bolge, ekip]);
  useEffect(() => { const t = setTimeout(() => yukle(1), q ? 300 : 0); return () => clearTimeout(t); }, [yukle]); // eslint-disable-line

  const dahaVar = meta.toplam !== null && satirlar.length < meta.toplam;
  const ust = (
    <View>
      <Alan deger={q} onDegis={setQ} ipucu="Personel adı yazın" autoCorrect={false} autoFocus returnKeyType="search" style={{ marginBottom: aralik.xs }} />
      <CipSecim secenekler={[{ id: "1", ad: "Aktif" }, { id: "0", ad: "Pasif" }, { id: "", ad: "Tümü" }]} deger={aktif} onSec={setAktif} style={{ marginBottom: aralik.xs }} />
      {(meta.filtreler?.bolgeler || []).length > 1 ? (
        <CipSecim secenekler={[{ id: "", ad: "Tüm bölgeler" }, ...meta.filtreler.bolgeler.map((b) => ({ id: b, ad: b }))]} deger={bolge} onSec={setBolge} style={{ marginBottom: aralik.xs }} />
      ) : null}
      {(meta.filtreler?.ekipler || []).length > 1 ? (
        <CipSecim secenekler={[{ id: "", ad: "Tüm ekipler" }, ...meta.filtreler.ekipler.slice(0, 12).map((b) => ({ id: b, ad: b }))]} deger={ekip} onSec={setEkip} style={{ marginBottom: aralik.xs }} />
      ) : null}
      {meta.toplam !== null && !durum.hata ? <Metin tur="minik" renk={renk.metinSoluk} style={{ marginBottom: aralik.xs }}>{meta.toplam} personel</Metin> : null}
    </View>
  );
  return (
    <Ekran baslik="Personel Yönetimi" altBaslik="Adı yazın; yetki kapsamınızdaki personel listelenir" kaydir={false}>
      <FlatList
        data={satirlar}
        keyExtractor={(x) => String(x.id)}
        contentContainerStyle={{ padding: aralik.m, paddingBottom: aralik.xxl }}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={ust}
        refreshControl={<RefreshControl refreshing={false} onRefresh={() => yukle(1)} />}
        renderItem={({ item: x }) => (
          <Kart style={{ marginBottom: aralik.xs }} onPress={() => navigation.navigate("PersonelDetay", { personel: x })} erisimEtiketi={`${x.ad_soyad}, ${x.unvan || ""}`}>
            <View style={{ flexDirection: "row", alignItems: "center" }}>
              <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: renk.yuzeyIkincil, alignItems: "center", justifyContent: "center" }}>
                <Metin tur="kucukKalin" renk={renk.lacivert}>{basHarfler(x.ad_soyad)}</Metin>
              </View>
              <View style={{ flex: 1, marginLeft: aralik.s }}>
                <Metin tur="govdeKalin" numberOfLines={1}>{x.ad_soyad}</Metin>
                <Metin tur="kucuk" renk={renk.metinIkincil} numberOfLines={1}>{[x.unvan, x.bolge, x.ekip].filter(Boolean).join(" · ") || "—"}</Metin>
              </View>
              {!x.aktif ? <Rozet metin="Pasif" tonAdi="notr" /> : null}
              <Ionicons name="chevron-forward" size={18} color={renk.metinSoluk} style={{ marginLeft: aralik.xs }} />
            </View>
          </Kart>
        )}
        ListEmptyComponent={durum.yukleniyor ? <><IskeletKart /><IskeletKart /></>
          : durum.hata ? <Kart><HataDurum hata={durum.hata} baslik="Personel listesi alınamadı" onTekrar={() => yukle(1)} /></Kart>
          : <Kart><BosDurum ikon="people-outline" baslik={q ? `"${q}" ile eşleşen personel yok` : "Personel bulunmuyor"} aciklama={q ? "Adın baş harflerini kontrol edin; yalnız yetki kapsamınızdaki personel listelenir." : "Bu filtrede personel bulunmuyor."} /></Kart>}
        onEndReachedThreshold={0.4}
        onEndReached={() => { if (dahaVar && !durum.ek && !durum.yukleniyor) yukle(meta.sayfa + 1); }}
        ListFooterComponent={durum.ek ? <IskeletKart /> : durum.hata && satirlar.length ? <Bant tonAdi="uyari" metin="Devamı yüklenemedi." eylem="Tekrar dene" onEylem={() => yukle(meta.sayfa + 1)} /> : null}
      />
    </Ekran>
  );
}

// ── Personel Detayı: her bölüm aynı personel kimliğinden; yetkisiz bölüm "yetkiniz yok" (sıfır değil) ──
const buAy = () => new Date().toISOString().slice(0, 7);
const ayKaydir = (d, n) => { const [y, m] = d.split("-").map(Number); const t = new Date(y, m - 1 + n, 1); return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}`; };

// Sekmeler: her bölüm aynı personel kimliğinden (useVeri anahtarı id + dönem); kişi değişince önceki kişinin verisi
// yeni anahtara taşınmaz (yeni kişi için iskelet görünür).
const SEKMELER = [{ id: "genel", ad: "Genel Bakış" }, { id: "hesap", ad: "Avans & Masraf" }, { id: "maas", ad: "Maaş" }, { id: "puantaj", ad: "Puantaj" }, { id: "isler", ad: "Saha & İşler" }, { id: "zimmet", ad: "Zimmet" }];
export function PersonelDetayEkrani({ route }) {
  const kisi = route.params.personel;
  const [donem, setDonem] = useState(buAy());
  const [sekme, setSekme] = useState("genel");
  const v = useVeri(`yonetimPersonel:${kisi.id}:${donem}`, () => yonetimApi.personelDetay(kisi.id, donem));
  const b = v.veri?.bolumler;
  const g = b?.genel?.veri || kisi;
  const S = (id) => sekme === id;
  return (
    <Ekran baslik={g.ad_soyad || "Personel"} altBaslik={[g.unvan, g.firma_ad || g.firma, g.bolge].filter(Boolean).join(" · ")} yenileniyor={v.yenileniyor} onYenile={v.yenile}>
      <CipSecim secenekler={SEKMELER} deger={sekme} onSec={setSekme} style={{ marginBottom: aralik.s }} />
      {v.yukleniyor && !v.veri ? <><IskeletKart /><IskeletKart /></> : null}
      {v.hata && !v.veri ? <Kart><HataDurum hata={v.hata} baslik="Personel bilgileri alınamadı" onTekrar={v.yenile} /></Kart> : null}
      <EskiVeriBandi v={v} style={{ marginBottom: aralik.s }} />
      {b && S("genel") ? (
        <>
          <Bolum baslik="Genel bilgiler" b={b.genel}>{(x) => (
            <Kart style={{ paddingVertical: aralik.xs }}>
              <BilgiSatiri etiket="Görev" deger={x.unvan} />
              <BilgiSatiri etiket="Firma" deger={x.firma_ad || x.firma} />
              <BilgiSatiri etiket="Bölge" deger={x.bolge} />
              <BilgiSatiri etiket="Ekip" deger={x.ekip} />
              <BilgiSatiri etiket="Telefon" deger={x.telefon} />
              <BilgiSatiri etiket="E-posta" deger={x.email} />
              <BilgiSatiri etiket="İşe giriş" deger={tarih(x.ise_giris_tarihi)} />
              <BilgiSatiri etiket="Durum" deger={x.aktif ? "Aktif" : `Pasif${x.isten_ayrilma_tarihi ? ` · ${tarih(x.isten_ayrilma_tarihi)}` : ""}`} son />
            </Kart>
          )}</Bolum>
          {b.hesap?.durum === "ok" || b.puantaj?.durum === "ok" ? (
            <>
              <BolumBasligi baslik={`Bu ay özet · ${ayAdi(Number(donem.slice(5)))} ${donem.slice(0, 4)}`} />
              <Kart style={{ paddingVertical: aralik.xs }}>
                {b.hesap?.durum === "ok" ? <BilgiSatiri etiket="Bakiye" deger={b.hesap.veri?.ozet?.bakiye > 0.005 ? `${tl(b.hesap.veri.ozet.bakiye)} · üzerinde avans` : b.hesap.veri?.ozet?.bakiye < -0.005 ? `${tl(Math.abs(b.hesap.veri.ozet.bakiye))} · şirketten alacaklı` : tl(0)} /> : null}
                {b.avans?.durum === "ok" ? <BilgiSatiri etiket="Onayda iş avansı" deger={`${(b.avans.veri || []).filter((a) => !["TAMAMLANDI", "REDDEDILDI"].includes(a.durum)).length} talep`} /> : null}
                {b.masraf?.durum === "ok" ? <BilgiSatiri etiket="Onayda masraf formu" deger={`${(b.masraf.veri || []).filter((f) => ["ROLLOUT_BEKLE", "MUHASEBE_BEKLE", "PM_BEKLE", "DIREKTOR_BEKLE"].includes(f.durum)).length} form`} /> : null}
                {b.puantaj?.durum === "ok" ? <BilgiSatiri etiket="Puantaj" deger={b.puantaj.veri?.kayit_var ? `${b.puantaj.veri.calisilan} gün çalıştı · ${b.puantaj.veri.devamsizlik} devamsızlık` : "Kayıt yok"} /> : null}
                {b.isler?.durum === "ok" ? <BilgiSatiri etiket="Açık saha işi" deger={`${(b.isler.veri?.atanan || []).filter((a) => !["TAMAMLANDI", "IPTAL"].includes(a.durum)).length}`} son /> : null}
              </Kart>
            </>
          ) : null}
          <Bolum baslik="İSG belgeleri" b={b.isg} bos="İSG eğitimi kaydı yok" yetkiMetni="İSG kayıtlarını görme yetkiniz yok.">{(x) => (
            <Kart style={{ paddingVertical: aralik.xs }}>
              {x.map((e, i, ar) => <BilgiSatiri key={i} etiket={e.egitim_turu} deger={e.bitis_tarihi ? `Bitiş ${tarih(e.bitis_tarihi)}` : tarih(e.egitim_tarihi)} son={i === ar.length - 1} />)}
            </Kart>
          )}</Bolum>
        </>
      ) : null}

      {b && S("hesap") ? (
        <>
          <Bolum baslik="Hesap hareketleri" b={b.hesap}>{(x) => (
            <Kart style={{ paddingVertical: aralik.xs }}>
              <BilgiSatiri etiket="Bakiye" deger={x.ozet?.bakiye > 0.005 ? `${tl(x.ozet.bakiye)} · üzerinde avans` : x.ozet?.bakiye < -0.005 ? `${tl(Math.abs(x.ozet.bakiye))} · şirketten alacaklı` : tl(0)} />
              <BilgiSatiri etiket="Ödenen iş avansı" deger={tl(x.ozet?.avans)} />
              <BilgiSatiri etiket="Kapanan masraf" deger={tl(x.ozet?.masraf)} />
              <BilgiSatiri etiket="Masraf ödemesi" deger={tl(x.ozet?.odeme)} />
              <BilgiSatiri etiket="Avans iadesi" deger={tl(x.ozet?.iade)} son={!(x.hareketler || []).length} />
              {(x.hareketler || []).slice(-6).reverse().map((h, i, a) => (
                <BilgiSatiri key={`${h.ref}-${i}`} etiket={`${tarih(h.tarih)} · ${h.baslik}`} deger={`${h.yon < 0 ? "−" : h.yon > 0 ? "+" : ""}${tl(h.tutar)}`} son={i === a.length - 1} />
              ))}
            </Kart>
          )}</Bolum>

          <Bolum baslik="İş avansları" b={b.avans} bos="İş avansı talebi yok">{(x) => (
            <Kart style={{ paddingVertical: aralik.xs }}>
              {x.slice(0, 15).map((a, i, ar) => {
                const d = durumBilgisi("avans", a.durum);
                return <BilgiSatiri key={a.id} etiket={`${tarih(a.tarih)} · ${a.gider_turu || "Avans"} · ${d.ad}${a.odeme_tarihi ? ` · ödendi ${tarih(a.odeme_tarihi)}` : ""}`} deger={tl(a.tutar)} son={i === ar.length - 1} />;
              })}
            </Kart>
          )}</Bolum>

          <Bolum baslik="Masraf formları" b={b.masraf} bos="Masraf formu yok">{(x) => (
            <Kart style={{ paddingVertical: aralik.xs }}>
              {x.slice(0, 15).map((f, i, ar) => {
                const d = durumBilgisi("masraf", f.durum);
                return <BilgiSatiri key={f.id} etiket={`${donemAdi(f.donem) || tarih(f.created_at)}${f.form_no ? ` · Form ${f.form_no}` : ""} · ${d.ad} · ${f.kalem} kalem, ${f.belge} fiş`} deger={tl(f.tutar)} son={i === ar.length - 1} />;
              })}
            </Kart>
          )}</Bolum>
          {b.hesap?.durum === "ok" ? <Metin tur="minik" renk={renk.metinSoluk} style={{ marginTop: aralik.xs }}>Bakiye ve hareketler web panelindeki hesap ekstresiyle aynı kaynaktan hesaplanır; mobilde ayrı hesap yapılmaz.</Metin> : null}
        </>
      ) : null}

      {b && S("maas") ? (
        <Bolum baslik="Maaş" b={b.maas} yetkiMetni="Maaş bilgisini görme yetkiniz yok. Personel Yönetimi erişimi maaş yetkisi vermez; şirket sahibi profili ya da kişiye özel maaş izni gerekir.">{(x) => (
          <>
            <Kart style={{ paddingVertical: aralik.xs }}>
              <BilgiSatiri etiket="Net maaş" deger={x.net_maas > 0 ? tl(x.net_maas) : "Tanımlı değil"} />
              <BilgiSatiri etiket={`${ayAdi(Number(donem.slice(5)))} ödenen`} deger={tl((x.odemeler || []).filter((o) => String(o.donem || "").slice(0, 7) === donem).reduce((t, o) => t + Number(o.tutar || 0), 0))} />
              <BilgiSatiri etiket={`${ayAdi(Number(donem.slice(5)))} kalan`} deger={x.net_maas > 0 ? tl(Math.max(0, Number(x.net_maas) - (x.odemeler || []).filter((o) => String(o.donem || "").slice(0, 7) === donem).reduce((t, o) => t + Number(o.tutar || 0), 0))) : "—"} son />
            </Kart>
            <BolumBasligi baslik="Maaş ödemeleri (son 12)" />
            <Kart style={{ paddingVertical: aralik.xs }}>
              {!(x.odemeler || []).length ? <Metin tur="kucuk" renk={renk.metinSoluk}>Ödeme kaydı yok</Metin>
                : x.odemeler.map((o, i, ar) => <BilgiSatiri key={i} etiket={`${donemAdi(o.donem) || o.donem} · ödeme ${tarih(o.tarih)}${o.aciklama ? ` · ${o.aciklama}` : ""}`} deger={tl(o.tutar)} son={i === ar.length - 1} />)}
            </Kart>
          </>
        )}</Bolum>
      ) : null}

      {b && S("puantaj") ? (
        <>
          <BolumBasligi baslik={`Puantaj · ${ayAdi(Number(donem.slice(5)))} ${donem.slice(0, 4)}`} />
          <View style={{ flexDirection: "row", gap: aralik.xs, marginBottom: aralik.xs }}>
            <Pressable onPress={() => setDonem(ayKaydir(donem, -1))} accessibilityRole="button" accessibilityLabel="Önceki ay" style={st.ayBtn}><Ionicons name="chevron-back" size={18} color={renk.lacivert} /></Pressable>
            <Pressable onPress={() => setDonem(ayKaydir(donem, 1))} disabled={donem >= buAy()} accessibilityRole="button" accessibilityLabel="Sonraki ay" style={[st.ayBtn, donem >= buAy() && { opacity: 0.4 }]}><Ionicons name="chevron-forward" size={18} color={renk.lacivert} /></Pressable>
          </View>
          <BolumIcerik b={b.puantaj}>{(x) => (!x.kayit_var ? <Kart><BosDurum ikon="calendar-outline" baslik="Bu ay puantaj kaydı yok" /></Kart> : (
            <>
              <Kart style={{ paddingVertical: aralik.xs }}>
                <BilgiSatiri etiket="Çalışılan gün" deger={String(x.calisilan)} />
                <BilgiSatiri etiket="İzin / dinlenme" deger={String(x.izin)} />
                <BilgiSatiri etiket="Devamsızlık" deger={String(x.devamsizlik)} />
                <BilgiSatiri etiket="Fazla mesai" deger={`${x.fazla_mesai_saat} saat`} son />
              </Kart>
              {(x.gunler || []).length ? (
                <>
                  <BolumBasligi baslik="Günlük kayıtlar" />
                  <Kart style={{ paddingVertical: aralik.xs }}>
                    {x.gunler.map((g2, i, ar) => <BilgiSatiri key={g2.tarih} etiket={`${tarih(g2.tarih, { yil: false })} · ${PUANTAJ_AD[g2.durum] || g2.durum}`} deger={[g2.fazla_mesai_saat > 0 ? `+${g2.fazla_mesai_saat} sa` : null, g2.aciklama].filter(Boolean).join(" · ") || " "} son={i === ar.length - 1} />)}
                  </Kart>
                </>
              ) : null}
            </>
          ))}</BolumIcerik>
        </>
      ) : null}

      {b && S("isler") ? (
        <Bolum baslik="Saha işleri" b={b.isler}>{(x) => (!(x.atanan || []).length ? <Kart><BosDurum ikon="navigate-outline" baslik="Atanmış iş yok" aciklama={x.not} /></Kart> : (
          <>
            {["acik", "bitti"].map((grup) => {
              const liste = x.atanan.filter((a) => (grup === "acik") !== ["TAMAMLANDI", "IPTAL"].includes(a.durum));
              if (!liste.length) return null;
              return (
                <View key={grup}>
                  <Metin tur="kucukKalin" renk={renk.metinIkincil} style={{ marginBottom: aralik.xs }}>{grup === "acik" ? `Atanan / devam eden (${liste.length})` : `Tamamlanan (${liste.length})`}</Metin>
                  <Kart style={{ paddingVertical: aralik.xs, marginBottom: aralik.s }}>
                    {liste.slice(0, 20).map((a, i, ar) => (
                      <BilgiSatiri key={a.id} etiket={`${(a.site_codes || []).join(", ")} · ${a.kategori_ad || a.kategori}${a.plan_tarihi ? ` · plan ${tarih(a.plan_tarihi)}` : ""}${a.bitis_ts ? ` · bitiş ${tarih(a.bitis_ts)}` : ""}`}
                        deger={`${durumBilgisi("is", a.durum).ad}${a.qc_durum ? ` · QC ${a.qc_durum}` : ""}`} son={i === ar.length - 1} />
                    ))}
                  </Kart>
                </View>
              );
            })}
          </>
        ))}</Bolum>
      ) : null}

      {b && S("zimmet") ? (
        <Bolum baslik="Malzeme / zimmet" b={b.zimmet} bos="Zimmetli malzeme yok">{(x) => (
          <Kart style={{ paddingVertical: aralik.xs }}>
            {x.slice(0, 20).map((z, i, ar) => <BilgiSatiri key={z.id} etiket={`${z.malzeme_adi} · ${durumBilgisi("zimmet", z.durum).ad}${z.verilme_tarihi ? ` · ${tarih(z.verilme_tarihi)}` : ""}${z.site_id ? ` · ${z.site_id}` : ""}`} deger={`${z.miktar} ${z.birim || ""}`.trim()} son={i === ar.length - 1} />)}
          </Kart>
        )}</Bolum>
      ) : null}
    </Ekran>
  );
}
const PUANTAJ_AD = { CALISDI: "Çalıştı", DINLENME: "Dinlenme", GELMEDI: "Gelmedi", IZINLI: "İzinli", IZIN: "İzin", YILLIK_IZIN: "Yıllık izin", RAPORLU: "Raporlu", RESMI_TATIL: "Resmî tatil" };

function Bolum({ baslik, b, bos, yetkiMetni, children }) {
  return (
    <>
      <BolumBasligi baslik={baslik} />
      <BolumIcerik b={b} bos={bos} yetkiMetni={yetkiMetni}>{children}</BolumIcerik>
    </>
  );
}
function BolumIcerik({ b, bos, yetkiMetni, children }) {
  if (!b) return <Kart><Metin tur="kucuk" renk={renk.metinSoluk}>Bilgi yok</Metin></Kart>;
  if (b.durum === "yetki_yok") return <Bant tonAdi="notr" ikon="lock-closed-outline" metin={yetkiMetni || "Bu bölümü görme yetkiniz yok."} />;
  if (b.durum !== "ok") return <Bant tonAdi="uyari" metin="Bu bölüm yüklenemedi. Sayfayı aşağı çekerek yenileyin." />;
  if (Array.isArray(b.veri) && !b.veri.length) return <Kart><Metin tur="kucuk" renk={renk.metinSoluk}>{bos || "Kayıt yok"}</Metin></Kart>;
  return children(b.veri);
}

const st = { ayBtn: { width: 44, height: 36, borderRadius: kose.m, borderWidth: 1, borderColor: renk.cizgiKoyu, alignItems: "center", justifyContent: "center", backgroundColor: renk.yuzey } };
