// Kişisel hesap ekstresi (web'deki ekstreyle aynı uç): hareketler + koşan bakiye. Hesap mobilde yeniden yapılmaz.
import React from "react";
import { View } from "react-native";
import { aralik, renk, yazi } from "../tema";
import { BolumBasligi, Kart, Metin, Satir } from "../bilesenler/temel";
import { BosDurum, HataDurum, IskeletKart } from "../bilesenler/durum";
import { Ekran } from "../bilesenler/Ekran";
import { useVeri } from "../api/veri";
import { panoApi } from "../api/uclar";
import { hesapDurumu } from "../mantik/hesap";
import { tarih, tl } from "../mantik/bicim";

const TIP = {
  AVANS: { ikon: "arrow-down-circle-outline", ton: "uyari" },
  ODEME: { ikon: "cash-outline", ton: "basari" },
  MASRAF: { ikon: "receipt-outline", ton: "marka" },
  IADE: { ikon: "return-down-back-outline", ton: "notr" },
  YEMEK: { ikon: "restaurant-outline", ton: "notr" },
};

export function HesapHareketleriEkrani() {
  const h = useVeri("hesap", () => panoApi.hesap());
  const v = h.veri;
  const d = hesapDurumu(v?.ozet?.bakiye);
  const hareketler = [...(v?.hareketler || [])].reverse(); // en yeni üstte
  return (
    <Ekran baslik="Hesap hareketleri" yenileniyor={h.yenileniyor} onYenile={h.yenile}>
      {h.yukleniyor && !v ? <><IskeletKart yukseklik={120} /><IskeletKart /></> : null}
      {h.hata && !v ? <Kart><HataDurum hata={h.hata} onTekrar={h.yenile} /></Kart> : null}
      {v ? (
        <>
          <Kart>
            <Metin tur="kucukKalin" renk={renk.metinIkincil}>{d.baslik}</Metin>
            <Metin tur="baslikXL" style={yazi.tutar}>{tl(d.tutar) ?? "—"}</Metin>
            <Metin tur="kucuk" renk={renk.metinIkincil}>{d.aciklama}</Metin>
            <View style={{ flexDirection: "row", marginTop: aralik.m, gap: aralik.s }}>
              <Ozet etiket="Alınan avans" deger={v.ozet?.avans} />
              <Ozet etiket="Kapanan masraf" deger={v.ozet?.masraf} />
              <Ozet etiket="Masraf ödemesi" deger={v.ozet?.odeme} />
            </View>
          </Kart>
          <BolumBasligi baslik="Hareketler" />
          {hareketler.length === 0 ? <Kart><BosDurum ikon="swap-vertical-outline" baslik="Henüz hesap hareketi yok" /></Kart> : (
            <Kart style={{ paddingVertical: 0 }}>
              {hareketler.map((x, i) => {
                const t = TIP[x.tip] || TIP.MASRAF;
                const isaret = x.yon > 0 ? "+" : x.yon < 0 ? "−" : "";
                return (
                  <Satir key={`${x.tip}-${x.ref}-${i}`} ikon={t.ikon} ikonTon={t.ton} baslik={x.baslik}
                    alt={[tarih(x.tarih), x.detay].filter(Boolean).join(" · ")}
                    sag={<Metin tur="govdeKalin" style={yazi.tutar} renk={x.yon === 0 ? renk.metinSoluk : renk.metin}>{isaret}{tl(x.tutar)?.replace("−", "")}</Metin>}
                    sagAlt={x.yon !== 0 ? `Bakiye ${tl(x.bakiye)}` : "Bakiyeye işlemez"} son={i === hareketler.length - 1} />
                );
              })}
            </Kart>
          )}
          <Metin tur="minik" renk={renk.metinSoluk} style={{ marginTop: aralik.s }}>
            Bakiye = ödenen iş avansları + masraf ödemeleri − kapanan (arşivlenen) masraf formları − avans iadeleri. Onaydaki kayıtlar bakiyeye işlenmez.
          </Metin>
        </>
      ) : null}
    </Ekran>
  );
}

function Ozet({ etiket, deger }) {
  return (
    <View style={{ flex: 1 }}>
      <Metin tur="minik" renk={renk.metinSoluk} numberOfLines={1}>{etiket}</Metin>
      <Metin tur="kucukKalin" style={yazi.tutar} numberOfLines={1} adjustsFontSizeToFit>{tl(deger, { kurus: false }) ?? "—"}</Metin>
    </View>
  );
}
