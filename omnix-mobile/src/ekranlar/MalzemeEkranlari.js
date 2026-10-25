// Malzeme talebi (web ile aynı: "Onaya gönder" → Rollout Müdürü onayı) ve talep detayı.
import React, { useEffect, useRef, useState } from "react";
import { Alert, Pressable, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { aralik, renk } from "../tema";
import { BilgiSatiri, BolumBasligi, Buton, Kart, Metin, Rozet } from "../bilesenler/temel";
import { Bant, HataDurum, Yukleniyor } from "../bilesenler/durum";
import { Alan, SecimAlani } from "../bilesenler/form";
import { Ekran } from "../bilesenler/Ekran";
import { useOturum } from "../oturum/OturumSaglayici";
import { useGecersizKil, useVeri } from "../api/veri";
import { malzemeApi } from "../api/uclar";
import { durumBilgisi } from "../mantik/durumlar";
import { isoGun, tarihUzun } from "../mantik/bicim";
import { hataMetni } from "../mantik/hata";
import { malzemeEslesmesi } from "../mantik/uzlastirma";
import { BOLGELER, MALZEME_BIRIMLERI, MALZEME_PROJELERI } from "../mantik/sabitler";
import { taslaklar, taslakKaydet, taslakSil } from "../taslak/taslakDepo";

const bosKalem = () => ({ malzeme_adi: "", miktar: "1", birim: "Adet" });

export function MalzemeTalepEkrani({ navigation }) {
  const { kullanici, kapsam } = useOturum();
  const gecersizKil = useGecersizKil();
  const [f, setF] = useState({ bolge: null, proje: null, site_id: "", notlar: "" });
  const [kalemler, setKalemler] = useState([bosKalem()]);
  const [taslakId, setTaslakId] = useState(null);
  const [adim, setAdim] = useState({});
  const [bekle, setBekle] = useState(null);
  const [hata, setHata] = useState(null);
  const kilit = useRef(false);
  const hazir = useRef(false);

  useEffect(() => {
    taslaklar(kapsam, "malzeme").then((l) => {
      const t = l[0];
      if (t) { setF(t.alanlar); setKalemler(t.kalemler?.length ? t.kalemler : [bosKalem()]); setTaslakId(t.id); setAdim(t.adim || {}); setHata(t.gonderimHatasi || null); }
      hazir.current = true;
    });
  }, [kapsam]);

  useEffect(() => {
    if (!hazir.current) return;
    if (!kalemler.some((k) => k.malzeme_adi.trim()) && !f.notlar && !f.site_id) return;
    const z = setTimeout(() => {
      taslakKaydet(kapsam, { id: taslakId || undefined, tur: "malzeme", alanlar: f, kalemler }).then((t) => setTaslakId(t.id)).catch(() => {});
    }, 400);
    return () => clearTimeout(z);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [f, kalemler]);

  const kalemDegis = (i, k, v) => setKalemler((l) => l.map((x, j) => (j === i ? { ...x, [k]: v } : x)));

  const gonder = async (durum) => {
    if (kilit.current) return;
    const dolu = kalemler.filter((k) => k.malzeme_adi.trim());
    if (!dolu.length) { setHata("En az bir malzeme adı girin."); return; }
    if (dolu.some((k) => !(Number(String(k.miktar).replace(",", ".")) > 0))) { setHata("Her kalem için geçerli bir miktar girin."); return; }
    kilit.current = true;
    setBekle(durum);
    setHata(null);
    const govde = {
      talep_eden_email: kullanici.email, talep_eden_ad: kullanici.name || kullanici.email, talep_tarihi: isoGun(), durum,
      bolge: f.bolge || "", proje: f.proje || "", site_id: f.site_id.trim().toUpperCase(), notlar: f.notlar.trim(),
      kalemler: dolu.map((k) => ({ malzeme_adi: k.malzeme_adi.trim(), miktar: Number(String(k.miktar).replace(",", ".")), birim: k.birim || "Adet", birim_fiyat: 0, toplam_tutar: 0 })),
    };
    let a = adim;
    try {
      const liste = await malzemeApi.taleplerim(kullanici);
      if (a.denendi) {
        const v = malzemeEslesmesi(liste, a.oncekiIdler, govde);
        if (v) { await bitti(durum); return; }
      }
      a = { denendi: true, oncekiIdler: (Array.isArray(liste) ? liste : []).map((x) => x.id) };
      setAdim(a);
      const t = await taslakKaydet(kapsam, { id: taslakId || undefined, tur: "malzeme", alanlar: f, kalemler, adim: a });
      setTaslakId(t.id);
      await malzemeApi.olustur(govde);
      await bitti(durum, t.id);
    } catch (e) {
      if (!e?.sonucBelirsiz && a.denendi) { a = { denendi: false }; setAdim(a); }
      const m = e?.sonucBelirsiz ? "Bağlantı koptu. Talebiniz telefonda saklandı; tekrar deneyin — ikinci kez oluşmaz." : hataMetni(e, "Talep gönderilemedi.");
      setHata(m);
      taslakKaydet(kapsam, { id: taslakId || undefined, tur: "malzeme", alanlar: f, kalemler, adim: a, gonderimHatasi: m }).then((t) => setTaslakId(t.id)).catch(() => {});
    } finally { kilit.current = false; setBekle(null); }
  };

  const bitti = async (durum, id = taslakId) => {
    await taslakSil(kapsam, id);
    gecersizKil(["malzemeTalepler"]);
    Alert.alert(durum === "TASLAK" ? "Taslak kaydedildi" : "Talep gönderildi", durum === "TASLAK" ? "Talebiniz taslak olarak kaydedildi; web panelinden de düzenleyebilirsiniz." : "Talebiniz Rollout Müdürü onayına gönderildi.");
    navigation.goBack();
  };

  return (
    <Ekran baslik="Malzeme talebi" klavye alt={(
      <View style={{ flexDirection: "row", gap: aralik.s }}>
        <Buton baslik="Taslak kaydet" tur="ikincil" onPress={() => gonder("TASLAK")} yukleniyor={bekle === "TASLAK"} devreDisi={!!bekle} style={{ flex: 1 }} />
        <Buton baslik="Onaya gönder" ikon="paper-plane-outline" onPress={() => gonder("ROLLOUT_BEKLE")} yukleniyor={bekle === "ROLLOUT_BEKLE"} devreDisi={!!bekle} style={{ flex: 1.3 }} />
      </View>
    )}>
      {hata ? <Bant tonAdi="uyari" metin={hata} style={{ marginBottom: aralik.m }} /> : null}
      <View style={{ flexDirection: "row", gap: aralik.s }}>
        <SecimAlani etiket="Bölge" aramali secenekler={BOLGELER} deger={f.bolge} onSec={(v) => setF({ ...f, bolge: v })} style={{ flex: 1 }} />
        <SecimAlani etiket="Proje" secenekler={MALZEME_PROJELERI} deger={f.proje} onSec={(v) => setF({ ...f, proje: v })} style={{ flex: 1 }} />
      </View>
      <Alan etiket="Site ID" yardim="Huawei'de PO olmadan malzeme çıkışı yapılamaz; biliyorsanız girin." deger={f.site_id} onDegis={(v) => setF({ ...f, site_id: v.toUpperCase() })} buyukHarf="characters" ipucu="Örn. IZ1234" />

      <BolumBasligi baslik="Malzemeler" style={{ marginTop: 0 }} />
      {kalemler.map((k, i) => (
        <Kart key={i} style={{ marginBottom: aralik.s }}>
          <View style={{ flexDirection: "row", alignItems: "center", marginBottom: aralik.xs }}>
            <Metin tur="kucukKalin" style={{ flex: 1 }}>Kalem {i + 1}</Metin>
            {kalemler.length > 1 ? (
              <Pressable onPress={() => setKalemler((l) => l.filter((_, j) => j !== i))} hitSlop={10} accessibilityRole="button" accessibilityLabel={`Kalem ${i + 1} sil`}>
                <Ionicons name="trash-outline" size={20} color={renk.hata} />
              </Pressable>
            ) : null}
          </View>
          <Alan etiket="Malzeme adı" deger={k.malzeme_adi} onDegis={(v) => kalemDegis(i, "malzeme_adi", v)} ipucu="Örn. 6 mm² topraklama kablosu" />
          <View style={{ flexDirection: "row", gap: aralik.s }}>
            <Alan etiket="Miktar" deger={String(k.miktar)} onDegis={(v) => kalemDegis(i, "miktar", v)} klavye="decimal-pad" style={{ flex: 1, marginBottom: 0 }} />
            <SecimAlani etiket="Birim" secenekler={MALZEME_BIRIMLERI} deger={k.birim} onSec={(v) => kalemDegis(i, "birim", v)} style={{ flex: 1, marginBottom: 0 }} />
          </View>
        </Kart>
      ))}
      <Buton baslik="Kalem ekle" ikon="add" tur="metin" onPress={() => setKalemler((l) => [...l, bosKalem()])} />
      <Alan etiket="Not" cokSatir deger={f.notlar} onDegis={(v) => setF({ ...f, notlar: v })} ipucu="Ne zaman, nereye lazım" style={{ marginTop: aralik.s }} />
    </Ekran>
  );
}

export function MalzemeDetayEkrani({ route }) {
  const t0 = route.params.talep;
  const v = useVeri(`malzeme:${t0.id}`, () => malzemeApi.talep(t0.id));
  const t = v.veri || t0;
  const d = durumBilgisi("malzeme", t.durum);
  return (
    <Ekran baslik={t.talep_no || "Malzeme talebi"} yenileniyor={v.yenileniyor} onYenile={v.yenile}>
      <Kart>
        <Rozet metin={d.ad} tonAdi={d.ton} />
        <View style={{ marginTop: aralik.s }}>
          <BilgiSatiri etiket="Tarih" deger={tarihUzun(t.talep_tarihi || t.created_at)} />
          <BilgiSatiri etiket="Bölge" deger={t.bolge} />
          <BilgiSatiri etiket="Proje" deger={t.proje} />
          <BilgiSatiri etiket="Site ID" deger={t.site_id} />
          <BilgiSatiri etiket="Not" deger={t.notlar} />
          <BilgiSatiri etiket="Onay notu" deger={t.onay_notu} son />
        </View>
      </Kart>
      <BolumBasligi baslik="Malzemeler" />
      {v.yukleniyor && !v.veri ? <Yukleniyor /> : null}
      {v.hata && !v.veri ? <HataDurum hata={v.hata} onTekrar={v.yenile} /> : null}
      {(v.veri?.kalemler || []).length ? (
        <Kart style={{ paddingVertical: aralik.xs }}>
          {v.veri.kalemler.map((k, i) => <BilgiSatiri key={k.id} etiket={k.malzeme_adi} deger={`${Number(k.miktar)} ${k.birim || ""}`} son={i === v.veri.kalemler.length - 1} />)}
        </Kart>
      ) : null}
    </Ekran>
  );
}
