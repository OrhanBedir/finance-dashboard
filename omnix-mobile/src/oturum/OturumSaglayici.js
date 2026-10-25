// Oturum yönetimi. Kural: rol ve firma her açılışta ve uygulama öne geldiğinde backend'den (/auth/me)
// doğrulanır; cihazda saklanan eski role/firmaya güvenilmez. Cihazda yalnız token (Keychain) tutulur.
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { AppState } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import { oturumApi } from "../api/uclar";
import { oturumDustuDinleyicisi, tokenAyarla } from "../api/istemci";
import { kapsamAnahtari, kimlikDegistiMi } from "../mantik/kapsam";
import { kapsamiTemizle, taslaklar } from "../taslak/taslakDepo";

const TOKEN_ANAHTARI = "omnix.oturum.v1";
const KURULUM_ISARETI = "omnix.kurulum.v1";
const GUVENLI = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };

const OturumBaglami = createContext(null);
export const useOturum = () => useContext(OturumBaglami);

// durum: acilis → (giris | dogrulaniyor) → hazir | baglantiYok
export function OturumSaglayici({ children }) {
  const [durum, setDurum] = useState("acilis");
  const [kullanici, setKullanici] = useState(null);
  const [bildirim, setBildirim] = useState(null); // giriş ekranında gösterilecek bilgi (ör. süre doldu)
  const kullaniciRef = useRef(null);
  kullaniciRef.current = kullanici;

  const oturumuKapat = useCallback(async () => {
    tokenAyarla(null);
    try { await SecureStore.deleteItemAsync(TOKEN_ANAHTARI, GUVENLI); } catch {}
    setKullanici(null);
    setDurum("giris");
  }, []);

  const dogrula = useCallback(async () => {
    setDurum("dogrulaniyor");
    try {
      const r = await oturumApi.ben();
      if (!r?.user?.id) throw new Error("kullanıcı yok");
      setKullanici(r.user);
      setDurum("hazir");
    } catch (e) {
      // 401 → dinleyici zaten giriş ekranına döndürdü; ağ/sunucu sorunu → firma doğrulanamadan panel açılmaz
      if (e?.tur === "oturum") return;
      setDurum("baglantiYok");
    }
  }, []);

  useEffect(() => {
    oturumDustuDinleyicisi((mesaj) => {
      setBildirim(mesaj);
      oturumuKapat(); // taslaklar SİLİNMEZ: aynı kişi yeniden girince kaldığı yerden devam eder
    });
    (async () => {
      // iOS anahtar zinciri uygulama silinip kurulunca da kalabilir: ilk açılışta eski token temizlenir
      const kurulu = await AsyncStorage.getItem(KURULUM_ISARETI).catch(() => null);
      if (!kurulu) {
        try { await SecureStore.deleteItemAsync(TOKEN_ANAHTARI, GUVENLI); } catch {}
        await AsyncStorage.setItem(KURULUM_ISARETI, "1").catch(() => {});
      }
      let token = null;
      try { token = await SecureStore.getItemAsync(TOKEN_ANAHTARI, GUVENLI); } catch {}
      if (!token) { setDurum("giris"); return; }
      tokenAyarla(token);
      dogrula();
    })();
  }, [dogrula, oturumuKapat]);

  // Uygulama öne gelince rol/firma tazelenir (yetki değişikliği yeniden giriş gerektirmez)
  useEffect(() => {
    const abone = AppState.addEventListener("change", async (s) => {
      if (s !== "active" || !kullaniciRef.current) return;
      try {
        const r = await oturumApi.ben();
        if (r?.user?.id) {
          if (kimlikDegistiMi(kullaniciRef.current, r.user) || JSON.stringify(r.user) !== JSON.stringify(kullaniciRef.current)) setKullanici(r.user);
        }
      } catch {}
    });
    return () => abone.remove();
  }, []);

  const girisYap = useCallback(async (email, sifre) => {
    const r = await oturumApi.giris(String(email).trim().toLowerCase(), sifre);
    if (!r?.token) throw new Error("token yok");
    await SecureStore.setItemAsync(TOKEN_ANAHTARI, r.token, GUVENLI);
    tokenAyarla(r.token);
    setBildirim(null);
    setKullanici(null);
    await dogrula(); // firma kimliği backend'den doğrulanana kadar Omnix yükleme ekranı
  }, [dogrula]);

  const bekleyenTaslakSayisi = useCallback(async () => {
    const k = kapsamAnahtari(kullaniciRef.current);
    return k ? (await taslaklar(k)).length : 0;
  }, []);

  // Çıkış / hesap değiştirme: token, bellekteki veriler ve bu kişinin taslakları silinir
  const cikisYap = useCallback(async () => {
    const k = kapsamAnahtari(kullaniciRef.current);
    await kapsamiTemizle(k);
    setBildirim(null);
    await oturumuKapat();
  }, [oturumuKapat]);

  const deger = useMemo(() => ({
    durum, kullanici, bildirim, girisYap, cikisYap, dogrula, bekleyenTaslakSayisi,
    kapsam: kapsamAnahtari(kullanici),
  }), [durum, kullanici, bildirim, girisYap, cikisYap, dogrula, bekleyenTaslakSayisi]);

  return <OturumBaglami.Provider value={deger}>{children}</OturumBaglami.Provider>;
}
