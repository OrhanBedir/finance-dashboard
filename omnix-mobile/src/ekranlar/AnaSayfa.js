// Ana sayfa: önce hesabım (doğru hesap türüyle), sonra bekleyenler ve hızlı işlemler, en altta bu ayın çalışma özeti.
import React, { useCallback, useState } from "react";
import { Pressable, RefreshControl, ScrollView, StatusBar, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFocusEffect } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
import { aralik, kose, renk, yazi } from "../tema";
import { BolumBasligi, IkonKutu, Kart, Metin, Rozet, Satir } from "../bilesenler/temel";
import { Bant, HataDurum, IskeletKart, EskiVeriBandi } from "../bilesenler/durum";
import { FirmaBasligi } from "../bilesenler/marka";
import { BaglantiBandi } from "../bilesenler/BaglantiBandi";
import { useOturum } from "../oturum/OturumSaglayici";
import { useVeri } from "../api/veri";
import { isApi, panoApi } from "../api/uclar";
import { firmaKimligi } from "../mantik/kapsam";
import { hesapDurumu, yoldakiler } from "../mantik/hesap";
import { ayAdi, basHarfler, tarih, tl } from "../mantik/bicim";
import { rolAdi } from "../mantik/durumlar";
import { taslaklar } from "../taslak/taslakDepo";

export function onayciMi(pano) {
  return !!(pano && (pano.isPM || pano.isDirektor || pano.isRM));
}

export function AnaSayfa({ navigation }) {
  const { kullanici, kapsam } = useOturum();
  const kenar = useSafeAreaInsets();
  const firma = firmaKimligi(kullanici);
  const pano = useVeri("pano", () => panoApi.pano(kullanici));
  const hesap = useVeri("hesap", () => panoApi.hesap());
  const isler = useVeri("isler", () => isApi.benim());
  const [yerelBekleyen, setYerelBekleyen] = useState(0);

  // Sekmeler aynı anda bağlı kaldığı için durum çubuğu rengi odak anında ayarlanır
  useFocusEffect(useCallback(() => { StatusBar.setBarStyle("light-content", true); }, []));
  useFocusEffect(useCallback(() => {
    let iptal = false;
    taslaklar(kapsam).then((t) => { if (!iptal) setYerelBekleyen(t.filter((x) => x.gonderimHatasi).length); });
    return () => { iptal = true; };
  }, [kapsam]));

  const yenileniyor = pano.yenileniyor || hesap.yenileniyor || isler.yenileniyor;
  const yenile = () => { pano.yenile(); hesap.yenile(); isler.yenile(); };

  const p = pano.veri;
  const ad = String(kullanici?.name || "").split(" ")[0] || "";
  const unvan = p?.personel?.unvan;
  const acikIs = isler.veri?.bekleyen?.length;
  const onayAdedi = (p?.onayBekleyenAvanslar?.length || 0) + (p?.isPM ? p?.onayBekleyenMalzemeler?.length || 0 : 0);

  return (
    <View style={{ flex: 1, backgroundColor: renk.zemin }}>
      <ScrollView
        contentContainerStyle={{ paddingBottom: aralik.xxl }}
        refreshControl={<RefreshControl refreshing={yenileniyor} onRefresh={yenile} tintColor="#fff" />}
      >
        {/* Firma kimliği — backend'in doğruladığı oturumdan */}
        <View style={{ backgroundColor: renk.lacivert, paddingTop: kenar.top + aralik.xs, paddingHorizontal: aralik.m, paddingBottom: 64 }}>
          <View style={{ flexDirection: "row", alignItems: "center" }}>
            <FirmaBasligi firma={firma} />
            <Pressable onPress={() => navigation.navigate("Profil")} accessibilityRole="button" accessibilityLabel="Profil ve çıkış"
              style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: "rgba(255,255,255,0.14)", alignItems: "center", justifyContent: "center", marginLeft: aralik.s }}>
              <Metin tur="kucukKalin" renk="#fff">{basHarfler(kullanici?.name)}</Metin>
            </Pressable>
          </View>
          <Metin tur="baslikXL" renk="#fff" style={{ marginTop: aralik.l }} numberOfLines={1}>Merhaba{ad ? `, ${ad}` : ""}</Metin>
          <Metin tur="kucuk" renk="#C7D3E3" numberOfLines={1}>{[unvan, rolAdi(kullanici?.role)].filter(Boolean).join(" · ")}</Metin>
        </View>
        <BaglantiBandi />

        <View style={{ paddingHorizontal: aralik.m, marginTop: -48 }}>
          <HesapKarti hesap={hesap} onHareketler={() => navigation.navigate("HesapHareketleri")} />

          {yerelBekleyen > 0 ? (
            <Bant tonAdi="uyari" style={{ marginTop: aralik.s }} baslik={`${yerelBekleyen} kayıt telefonda bekliyor`}
              metin="Bağlantı sorunu nedeniyle gönderilemedi. Bilgileriniz kaybolmadı." eylem="Gönderilmeyenleri gör" onEylem={() => navigation.navigate("Harcamalar")} />
          ) : null}

          {onayciMi(p) && onayAdedi > 0 ? (
            <Kart style={{ marginTop: aralik.s }} onPress={() => navigation.navigate("Onaylar")} erisimEtiketi={`${onayAdedi} kayıt onayınızı bekliyor`}>
              <View style={{ flexDirection: "row", alignItems: "center" }}>
                <IkonKutu ad="checkmark-done-outline" tonAdi="uyari" />
                <View style={{ flex: 1, marginLeft: aralik.s }}>
                  <Metin tur="govdeKalin">{onayAdedi} kayıt onayınızı bekliyor</Metin>
                  <Metin tur="kucuk" renk={renk.metinIkincil}>İş avansı{p?.isPM ? " ve malzeme" : ""} talepleri</Metin>
                </View>
                <Ionicons name="chevron-forward" size={18} color={renk.metinSoluk} />
              </View>
            </Kart>
          ) : null}

          <BolumBasligi baslik="Hızlı işlemler" />
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: aralik.s }}>
            <HizliIslem ikon="receipt-outline" baslik="Masraf ekle" alt="Fiş yükle" onPress={() => navigation.navigate("Harcamalar", { sekme: "masraf" })} />
            <HizliIslem ikon="wallet-outline" baslik="İş avansı" alt="Talep oluştur" onPress={() => navigation.navigate("AvansTalep")} />
            <HizliIslem ikon="cube-outline" baslik="Malzeme talebi" alt="Depodan iste" onPress={() => navigation.navigate("MalzemeTalep")} />
            <HizliIslem ikon="navigate-outline" baslik="İşlerim" alt={acikIs ? `${acikIs} açık iş` : "Rollout"} rozet={acikIs} onPress={() => navigation.navigate("Saha")} />
          </View>

          <CalismaOzeti pano={pano} />
          <Cezalar pano={p} />
        </View>
      </ScrollView>
      {/* Kaydırınca saat/pil göstergesi beyaz içeriğe binmesin: durum çubuğu alanı hep lacivert */}
      <View pointerEvents="none" style={{ position: "absolute", top: 0, left: 0, right: 0, height: kenar.top, backgroundColor: renk.lacivert }} />
    </View>
  );
}

function HesapKarti({ hesap, onHareketler }) {
  if (hesap.yukleniyor && !hesap.veri) return <IskeletKart yukseklik={180} />;
  if (hesap.hata && !hesap.veri) {
    return <Kart><HataDurum hata={hesap.hata} baslik="Hesap bilgisi alınamadı" onTekrar={hesap.yenile} style={{ paddingVertical: aralik.m }} /></Kart>;
  }
  const h = hesap.veri;
  const d = hesapDurumu(h?.ozet?.bakiye);
  const y = yoldakiler(h);
  const tonRenk = { uyari: renk.uyari, basari: renk.basari, notr: renk.metin }[d.ton] || renk.metin;
  return (
    <Kart>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <Metin tur="etiket" renk={renk.metinIkincil} style={{ textTransform: "uppercase", letterSpacing: 0.6 }}>Hesabım</Metin>
      </View>
      {/* Yenileme başarısızsa eski sonuç "Hesabınız kapalı / 0,00" gibi kesin sunulmaz: zamanıyla "son bilinen" olarak gösterilir */}
      <EskiVeriBandi v={hesap} style={{ marginTop: aralik.xs }} />
      <Metin tur="govdeKalin" style={{ marginTop: aralik.xs }}>{hesap.hata ? `Son bilinen: ${d.baslik.charAt(0).toLocaleLowerCase("tr-TR")}${d.baslik.slice(1)}` : d.baslik}</Metin>
      <Metin tur="dev" renk={tonRenk} style={[yazi.tutar, { marginTop: 2 }]} adjustsFontSizeToFit numberOfLines={1} maxFontSizeMultiplier={1.3}
        accessibilityLabel={`${d.baslik}: ${tl(d.tutar)}`}>{tl(d.tutar) ?? "—"}</Metin>
      <Metin tur="kucuk" renk={renk.metinIkincil} style={{ marginTop: 2 }}>{d.aciklama}</Metin>

      {(y.avansTalepleri.adet || y.onaydakiFormlar.adet || y.taslakFormlar.adet || y.kapanisBekleyen.adet) ? (
        <View style={{ marginTop: aralik.m, backgroundColor: renk.yuzeyIkincil, borderRadius: kose.m, paddingHorizontal: aralik.s }}>
          <Metin tur="minik" renk={renk.metinSoluk} style={{ paddingTop: aralik.xs }}>Henüz bakiyeye işlenmeyenler</Metin>
          {y.avansTalepleri.adet ? <YoldaSatir ikon="wallet-outline" baslik={`${y.avansTalepleri.adet} iş avansı talebi onayda`} alt="Muhasebe ödeyince hesabınıza işlenir" tutar={y.avansTalepleri.tutar} /> : null}
          {y.onaydakiFormlar.adet ? <YoldaSatir ikon="hourglass-outline" baslik={`${y.onaydakiFormlar.adet} masraf formu onayda`} alt="Kapanınca avansınızdan düşer" tutar={y.onaydakiFormlar.tutar} /> : null}
          {y.kapanisBekleyen.adet ? <YoldaSatir ikon="checkmark-circle-outline" baslik={`${y.kapanisBekleyen.adet} masraf formu onaylandı`} alt="Muhasebe kapanışı bekleniyor" tutar={y.kapanisBekleyen.tutar} /> : null}
          {y.taslakFormlar.adet ? <YoldaSatir ikon="create-outline" baslik="Taslak masraf formu" alt="Henüz onaya gönderilmedi" tutar={y.taslakFormlar.tutar} son /> : null}
        </View>
      ) : null}

      <Pressable onPress={onHareketler} accessibilityRole="button" hitSlop={8} style={{ flexDirection: "row", alignItems: "center", marginTop: aralik.m }}>
        <Metin tur="kucukKalin" renk={renk.lacivertAcik}>Hesap hareketleri</Metin>
        <Ionicons name="chevron-forward" size={16} color={renk.lacivertAcik} />
      </Pressable>
    </Kart>
  );
}

function YoldaSatir({ ikon, baslik, alt, tutar, son }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", paddingVertical: aralik.xs, borderBottomWidth: son ? 0 : 0.5, borderBottomColor: renk.cizgi }}>
      <Ionicons name={ikon} size={18} color={renk.metinIkincil} style={{ marginRight: aralik.xs }} />
      <View style={{ flex: 1 }}>
        <Metin tur="kucukKalin">{baslik}</Metin>
        <Metin tur="minik" renk={renk.metinSoluk}>{alt}</Metin>
      </View>
      <Metin tur="kucukKalin" style={yazi.tutar}>{tl(tutar)}</Metin>
    </View>
  );
}

function HizliIslem({ ikon, baslik, alt, onPress, rozet }) {
  return (
    <Kart onPress={onPress} style={{ width: "48.5%", flexGrow: 1, flexBasis: "45%" }} erisimEtiketi={`${baslik}, ${alt}`}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" }}>
        <IkonKutu ad={ikon} />
        {rozet ? <Rozet metin={String(rozet)} tonAdi="uyari" /> : null}
      </View>
      <Metin tur="govdeKalin" style={{ marginTop: aralik.s }}>{baslik}</Metin>
      <Metin tur="minik" renk={renk.metinIkincil}>{alt}</Metin>
    </Kart>
  );
}

function CalismaOzeti({ pano }) {
  const p = pano.veri;
  if (pano.yukleniyor && !p) return (<><BolumBasligi baslik="Bu ay" /><IskeletKart yukseklik={110} /></>);
  if (pano.hata && !p) return (<><BolumBasligi baslik="Bu ay" /><Kart><HataDurum hata={pano.hata} onTekrar={pano.yenile} style={{ paddingVertical: aralik.s }} /></Kart></>);
  if (!p?.personelBulundu || !p?.puantaj) return null;
  const pu = p.puantaj;
  const kutu = (deger, etiket, r) => (
    <View style={{ flex: 1, alignItems: "center", paddingVertical: aralik.s }} accessible accessibilityLabel={`${etiket}: ${deger} gün`}>
      <Metin tur="baslikL" renk={r} style={yazi.tutar}>{deger ?? "—"}</Metin>
      <Metin tur="minik" renk={renk.metinIkincil}>{etiket}</Metin>
    </View>
  );
  return (
    <>
      <BolumBasligi baslik={`${ayAdi(p.ay)} ${p.yil} · Çalışma özeti`} />
      <Kart dolgu={false}>
        <View style={{ flexDirection: "row", paddingHorizontal: aralik.xs }}>
          {kutu(pu.calisilan, "Çalışılan", renk.basari)}
          {kutu(pu.dinlenme, "Dinlenme", renk.bilgi)}
          {kutu(pu.gelmedi, "Gelmedi", renk.hata)}
          {kutu(pu.toplam_gun, "Toplam", renk.metin)}
        </View>
        {pu.fazla_mesai_gun > 0 ? (
          <View style={{ borderTopWidth: 0.5, borderTopColor: renk.cizgi, padding: aralik.s, flexDirection: "row", alignItems: "center" }}>
            <Ionicons name="time-outline" size={16} color={renk.uyari} />
            <Metin tur="kucuk" style={{ marginLeft: 6 }}>Fazla mesai: <Metin tur="kucukKalin">{pu.fazla_mesai_gun} gün</Metin></Metin>
          </View>
        ) : null}
      </Kart>
    </>
  );
}

function Cezalar({ pano }) {
  const c = pano?.cezaKalemler || [];
  if (!c.length) return null;
  return (
    <>
      <BolumBasligi baslik="Trafik cezaları" />
      <Kart style={{ paddingVertical: 0 }}>
        {c.slice(0, 5).map((x, i) => (
          <Satir key={x.id || i} ikon="alert-circle-outline" ikonTon="hata" baslik={x.plaka || "Plaka yok"}
            alt={[x.aciklama || "Trafik cezası", tarih(x.tarih)].filter(Boolean).join(" · ")} sag={tl(x.tutar) || "—"} son={i === Math.min(c.length, 5) - 1} />
        ))}
      </Kart>
    </>
  );
}
