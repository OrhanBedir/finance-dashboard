// İş avansı talebi ve detay. Sıra: Personel → Rollout Müdürü → Proje Müdürü → Proje Direktörü → Muhasebe ödemesi
// (durumu backend belirler; ör. Rollout onaycısının kendi talebi doğrudan Proje Direktörüne gider).
import React, { useEffect, useRef, useState } from "react";
import { Alert, View } from "react-native";
import { aralik, renk, yazi } from "../tema";
import { BilgiSatiri, Buton, Kart, Metin, Rozet } from "../bilesenler/temel";
import { Bant } from "../bilesenler/durum";
import { Alan, CipSecim, SecimAlani, TarihAlani, TutarAlani } from "../bilesenler/form";
import { AkisAdimlari } from "../bilesenler/AkisAdimlari";
import { Ekran } from "../bilesenler/Ekran";
import { useOturum } from "../oturum/OturumSaglayici";
import { useGecersizKil } from "../api/veri";
import { avansApi } from "../api/uclar";
import { durumBilgisi } from "../mantik/durumlar";
import { ibanDuzelt, ibanGecerli, ibanGoster, isoGun, plakaDuzelt, tarihUzun, tl, tutarCoz } from "../mantik/bicim";
import { hataMetni } from "../mantik/hata";
import { avansEslesmesi } from "../mantik/uzlastirma";
import { BOLGELER, GIDER_TURLERI, PROJELER } from "../mantik/sabitler";
import { taslaklar, taslakKaydet, taslakSil } from "../taslak/taslakDepo";

const BOS = { kimIcin: null, tarih: isoGun(), giderTuru: null, bolge: null, proje: null, tutarMetni: "", aciklama: "", plaka: "", aracKm: "", bankaAdi: "", iban: "" };

export function AvansTalepEkrani({ navigation }) {
  const { kullanici, kapsam } = useOturum();
  const gecersizKil = useGecersizKil();
  const [f, setF] = useState(BOS);
  const [taslakId, setTaslakId] = useState(null);
  const [adim, setAdim] = useState({}); // { denendi, oncekiIdler, gonderilen }
  const [geriYuklendi, setGeriYuklendi] = useState(false);
  const [personel, setPersonel] = useState({ yetkili: false, rows: [] });
  const [atananPlaka, setAtananPlaka] = useState("");
  const [hatalar, setHatalar] = useState({});
  const [bekle, setBekle] = useState(false);
  const [gonderimHatasi, setGonderimHatasi] = useState(null);
  const [sonuc, setSonuc] = useState(null);
  const kilit = useRef(false);
  const hazir = useRef(false);

  // Yarım kalan talep varsa geri yükle (yalnız bu kullanıcının kapsamından)
  useEffect(() => {
    taslaklar(kapsam, "avans").then((l) => {
      const t = l[0];
      if (t) { setF({ ...BOS, ...t.alanlar }); setTaslakId(t.id); setAdim(t.adim || {}); setGeriYuklendi(true); setGonderimHatasi(t.gonderimHatasi || null); }
      hazir.current = true;
    });
    avansApi.personelSecim().then((d) => { if (d?.yetkili) setPersonel({ yetkili: true, rows: d.rows || [] }); }).catch(() => {});
    avansApi.atananArac(kullanici).then((d) => { if (d?.plaka) setAtananPlaka(String(d.plaka).toUpperCase()); }).catch(() => {});
  }, [kapsam, kullanici]);

  useEffect(() => {
    if (!hazir.current || sonuc) return;
    const dolu = f.giderTuru || f.tutarMetni || f.aciklama;
    if (!dolu) return;
    const z = setTimeout(() => {
      taslakKaydet(kapsam, { id: taslakId || undefined, tur: "avans", alanlar: f }).then((t) => setTaslakId(t.id)).catch(() => {});
    }, 400);
    return () => clearTimeout(z);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [f]);

  const set = (k, v) => { setF((x) => ({ ...x, [k]: v })); setHatalar((h) => ({ ...h, [k]: null })); };
  useEffect(() => { if (f.giderTuru === "Yakıt" && !f.plaka && atananPlaka) set("plaka", atananPlaka); }, [f.giderTuru, atananPlaka]); // eslint-disable-line

  // 25.10.2026 (Orhan): "Kim için" seçilince o personelin kayıtlı banka/IBAN'ı gelir (backend yetkiyi ve kapsamı denetler).
  // Elle yazılmış değer ezilmez: yalnız alanlar boşken ya da önceki değer de otomatik doldurulmuşken yazılır.
  const otoHesap = useRef(null); // son otomatik yazılan { bankaAdi, iban }
  const [hesapKaynak, setHesapKaynak] = useState(null); // "personel" | "yok" | null
  useEffect(() => {
    let iptal = false;
    avansApi.odemeHesabi(f.kimIcin).then((d) => {
      if (iptal) return;
      setF((x) => {
        const o = otoHesap.current;
        const dokunulmamis = (!x.bankaAdi && !x.iban) || (o && x.bankaAdi === o.bankaAdi && x.iban === o.iban);
        if (!dokunulmamis) { setHesapKaynak(null); return x; }
        if (d?.iban) { otoHesap.current = { bankaAdi: d.banka_adi || "", iban: ibanDuzelt(d.iban) }; setHesapKaynak("personel"); return { ...x, bankaAdi: d.banka_adi || "", iban: ibanDuzelt(d.iban) }; }
        otoHesap.current = null; setHesapKaynak("yok");
        return o ? { ...x, bankaAdi: "", iban: "" } : x; // önceki kişinin otomatik hesabı yeni kişiye taşınmaz
      });
    }).catch(() => { if (!iptal) setHesapKaynak(null); }); // yetki yoksa / bağlantı yoksa sessizce elle giriş
    return () => { iptal = true; };
  }, [f.kimIcin]); // eslint-disable-line

  const dogrula = () => {
    const h = {};
    if (!f.giderTuru) h.giderTuru = "Gider türünü seçin.";
    if (!f.bolge) h.bolge = "Bölge seçin.";
    if (!f.proje) h.proje = "Proje seçin.";
    const tutar = tutarCoz(f.tutarMetni);
    if (!tutar) h.tutarMetni = "Geçerli bir tutar girin.";
    if (f.giderTuru === "Yakıt" && !f.plaka.trim()) h.plaka = "Araç plakasını girin.";
    if (ibanDuzelt(f.iban) && !ibanGecerli(f.iban)) h.iban = "IBAN hatalı görünüyor. TR ile başlayan 26 karakteri kontrol edin.";
    if (ibanDuzelt(f.iban) && !f.bankaAdi.trim()) h.bankaAdi = "IBAN'ın ait olduğu bankayı yazın.";
    setHatalar(h);
    return Object.keys(h).length ? null : tutar;
  };

  const gonder = async () => {
    if (kilit.current) return;
    const tutar = dogrula();
    if (!tutar) return;
    kilit.current = true;
    setBekle(true);
    setGonderimHatasi(null);
    const govde = {
      talep_eden_ad: kullanici.name || kullanici.email,
      talep_eden_email: kullanici.email,
      personel_id: f.kimIcin || undefined,
      tarih: f.tarih,
      gider_turu: f.giderTuru,
      bolge: f.bolge,
      proje: f.proje,
      tutar,
      aciklama: f.aciklama.trim(),
      plaka: f.plaka.trim() ? plakaDuzelt(f.plaka) : undefined,
      arac_km: f.aracKm.trim() ? Number(f.aracKm.replace(/\D/g, "")) : null,
      // Ödemenin yapılacağı hesap (eski mobil ve web ile aynı alanlar; boşsa gönderilmez)
      banka_adi: f.bankaAdi.trim() || undefined,
      iban: ibanDuzelt(f.iban) || undefined,
    };
    let a = adim;
    try {
      // Önceki deneme yarıda kaldıysa: sunucuda aynı talep oluşmuş mu? Oluştuysa yeniden gönderilmez
      const liste = await avansApi.listem(kullanici);
      if (a.denendi) {
        const var_ = avansEslesmesi(liste, a.oncekiIdler, govde);
        if (var_) { await bitir(var_); return; }
      }
      a = { denendi: true, oncekiIdler: (Array.isArray(liste) ? liste : []).map((r) => r.id) };
      setAdim(a);
      const t = await taslakKaydet(kapsam, { id: taslakId || undefined, tur: "avans", alanlar: f, adim: a });
      setTaslakId(t.id);
      const r = await avansApi.olustur(govde);
      if (!r?.id) throw new Error("kayıt yok");
      await bitir(r, t.id);
    } catch (e) {
      if (!e?.sonucBelirsiz && a.denendi) { a = { denendi: false }; setAdim(a); } // kesin red: sunucuda kayıt oluşmadı
      const mesaj = e?.sonucBelirsiz
        ? "Bağlantı koptu. Talebiniz telefonda saklandı; tekrar deneyin — aynı talep ikinci kez oluşmaz."
        : hataMetni(e, "Talep gönderilemedi.");
      setGonderimHatasi(mesaj);
      if (taslakId || f.giderTuru) taslakKaydet(kapsam, { id: taslakId || undefined, tur: "avans", alanlar: f, adim: a, gonderimHatasi: mesaj }).then((t) => setTaslakId(t.id)).catch(() => {});
    } finally {
      kilit.current = false;
      setBekle(false);
    }
  };

  const bitir = async (kayit, id = taslakId) => {
    await taslakSil(kapsam, id);
    gecersizKil(["avanslar", "hesap", "pano"]);
    setSonuc(kayit);
  };

  if (sonuc) {
    const d = durumBilgisi("avans", sonuc.durum);
    return (
      <Ekran baslik="Talep gönderildi" geri={false}>
        <Kart>
          <Rozet metin="Gönderildi" tonAdi="basari" ikon="checkmark-circle" />
          <Metin tur="baslikXL" style={[yazi.tutar, { marginTop: aralik.s }]}>{tl(sonuc.tutar)}</Metin>
          <Metin tur="govde" style={{ marginTop: 4 }}>{[sonuc.gider_turu, sonuc.proje].filter(Boolean).join(" · ")}</Metin>
          <Metin tur="kucuk" renk={renk.metinIkincil} style={{ marginTop: aralik.s }}>Şu an: {d.ad}</Metin>
          <View style={{ marginTop: aralik.m }}><AkisAdimlari tur="avans" durum={sonuc.durum} /></View>
          <Bant tonAdi="bilgi" style={{ marginTop: aralik.m }} metin="Avans, muhasebe ödemeyi yaptığında hesabınıza işlenir. Durumu Harcamalar > İş avanslarım bölümünden takip edebilirsiniz." />
        </Kart>
        <Buton baslik="Tamam" onPress={() => navigation.goBack()} style={{ marginTop: aralik.m }} />
      </Ekran>
    );
  }

  return (
    <Ekran baslik="İş avansı talebi" klavye alt={<Buton baslik={gonderimHatasi ? "Tekrar dene" : "Talebi gönder"} ikon="paper-plane-outline" onPress={gonder} yukleniyor={bekle} />}>
      {geriYuklendi && !gonderimHatasi ? <Bant tonAdi="bilgi" metin="Yarım kalan talebiniz geri yüklendi." style={{ marginBottom: aralik.m }} eylem="Temizle"
        onEylem={async () => { await taslakSil(kapsam, taslakId); setF(BOS); setTaslakId(null); setAdim({}); setGeriYuklendi(false); }} /> : null}
      {gonderimHatasi ? <Bant tonAdi="uyari" baslik="Henüz gönderilmedi" metin={gonderimHatasi} style={{ marginBottom: aralik.m }} /> : null}

      {personel.yetkili ? (
        <SecimAlani etiket="Kim için" yardim="Boş bırakırsanız talep sizin adınıza açılır." aramali deger={f.kimIcin} ipucu="Kendim"
          secenekler={[{ id: null, ad_soyad: "Kendim" }, ...personel.rows]} etiketGetir={(p) => p.ad_soyad + (p.unvan ? ` · ${p.unvan}` : "")} anahtarGetir={(p) => p.id}
          onSec={(id) => set("kimIcin", id)} />
      ) : null}
      <CipSecim etiket="Gider türü" zorunlu secenekler={GIDER_TURLERI} deger={f.giderTuru} onSec={(v) => set("giderTuru", v)} hata={hatalar.giderTuru} />
      <TutarAlani etiket="Tutar" zorunlu deger={f.tutarMetni} onDegis={(v) => set("tutarMetni", v)} hata={hatalar.tutarMetni} />
      <View style={{ flexDirection: "row", gap: aralik.s }}>
        <SecimAlani etiket="Bölge" zorunlu aramali secenekler={BOLGELER} deger={f.bolge} onSec={(v) => set("bolge", v)} hata={hatalar.bolge} style={{ flex: 1 }} />
        <View style={{ flex: 1 }}><TarihAlani etiket="Tarih" zorunlu deger={f.tarih} onDegis={(v) => set("tarih", v)} /></View>
      </View>
      <SecimAlani etiket="Proje" zorunlu secenekler={PROJELER} deger={f.proje} onSec={(v) => set("proje", v)} hata={hatalar.proje} />
      {f.giderTuru === "Yakıt" ? (
        <View style={{ flexDirection: "row", gap: aralik.s }}>
          <Alan etiket="Araç plakası" zorunlu deger={f.plaka} onDegis={(v) => set("plaka", v.toUpperCase())} buyukHarf="characters" ipucu="16 ABC 123" hata={hatalar.plaka} style={{ flex: 1.3 }} />
          <Alan etiket="Araç KM" deger={f.aracKm} onDegis={(v) => set("aracKm", v.replace(/[^\d]/g, ""))} klavye="number-pad" ipucu="125000" style={{ flex: 1 }} />
        </View>
      ) : null}
      <Alan etiket="Açıklama / gerekçe" cokSatir deger={f.aciklama} onDegis={(v) => set("aciklama", v)} ipucu="Hangi iş için, kaç gün, kimlerle" />
      <Metin tur="etiket" renk={renk.metinIkincil} style={{ marginTop: aralik.xs, marginBottom: aralik.xs, textTransform: "uppercase", letterSpacing: 0.6 }}>Ödeme hesabı</Metin>
      <Alan etiket="Banka adı" deger={f.bankaAdi} onDegis={(v) => set("bankaAdi", v)} ipucu="Örn. Ziraat Bankası" hata={hatalar.bankaAdi} />
      <Alan etiket="IBAN" deger={ibanGoster(f.iban)} onDegis={(v) => set("iban", ibanDuzelt(v).slice(0, 26))} ipucu="TR00 0000 0000 0000 0000 0000 00"
        buyukHarf="characters" autoCorrect={false} hata={hatalar.iban}
        yardim={hesapKaynak === "personel" && f.iban ? `${f.kimIcin ? "Seçilen personelin" : "Sizin"} kayıtlı hesabından dolduruldu; farklı hesaba ödenecekse değiştirin.`
          : hesapKaynak === "yok" ? `${f.kimIcin ? "Seçilen personelin" : "Sizin"} kayıtlı IBAN'ı yok; avans bu hesaba ödenecekse girin.`
          : "Avans bu hesaba ödenecekse girin; boş bırakılırsa muhasebe kayıtlı hesabınızı kullanır."} />
    </Ekran>
  );
}

export function AvansDetayEkrani({ route }) {
  const a = route.params.avans;
  const d = durumBilgisi("avans", a.durum);
  return (
    <Ekran baslik="İş avansı" altBaslik={`#${a.id}`}>
      <Kart>
        <Rozet metin={d.ad} tonAdi={d.ton} />
        <Metin tur="baslikXL" style={[yazi.tutar, { marginTop: aralik.s }]}>{tl(a.tutar)}</Metin>
        <View style={{ marginTop: aralik.m }}><AkisAdimlari tur="avans" durum={a.durum} /></View>
        {a.durum === "REDDEDILDI" && a.red_aciklama ? <Bant tonAdi="hata" baslik="Ret gerekçesi" metin={a.red_aciklama} style={{ marginTop: aralik.m }} /> : null}
      </Kart>
      <Kart style={{ marginTop: aralik.s, paddingVertical: aralik.xs }}>
        <BilgiSatiri etiket="Gider türü" deger={a.gider_turu} />
        <BilgiSatiri etiket="Proje" deger={a.proje} />
        <BilgiSatiri etiket="Bölge" deger={a.bolge} />
        <BilgiSatiri etiket="Tarih" deger={tarihUzun(a.tarih || a.created_at)} />
        <BilgiSatiri etiket="Kim için" deger={a.personel_ad} />
        <BilgiSatiri etiket="Plaka" deger={a.plaka} />
        <BilgiSatiri etiket="Araç KM" deger={a.arac_km != null && a.arac_km !== "" ? Number(a.arac_km).toLocaleString("tr-TR") : null} />
        <BilgiSatiri etiket="Ödeme tarihi" deger={tarihUzun(a.odeme_tarihi)} />
        <BilgiSatiri etiket="Banka" deger={a.banka_adi} />
        <BilgiSatiri etiket="IBAN" deger={a.iban ? ibanGoster(a.iban) : null} />
        <BilgiSatiri etiket="Açıklama" deger={a.aciklama} son />
      </Kart>
    </Ekran>
  );
}
