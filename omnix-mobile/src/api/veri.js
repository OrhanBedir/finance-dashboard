// Ekran verisi: oturum boyunca bellekte tutulur (diske YAZILMAZ). Sağlayıcı kullanıcı/firma anahtarıyla
// yeniden kurulduğu için hesap değişince önceki kişinin verisi bellekte de kalmaz.
// Hata ayrı döner: veri yüklenemediğinde ekran "0 ₺" değil, hata ve "Tekrar dene" gösterir.
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { useFocusEffect } from "@react-navigation/native";

const VeriBaglami = createContext(null);

export function VeriSaglayici({ children }) {
  const depo = useRef({ onbellek: new Map(), zaman: new Map(), surum: new Map(), dinleyici: new Set() });
  return <VeriBaglami.Provider value={depo.current}>{children}</VeriBaglami.Provider>;
}

// Bir işlemden sonra ilgili ekranların veriyi yeniden çekmesi için: gecersizKil(["pano", "hesap"])
export function useGecersizKil() {
  const depo = useContext(VeriBaglami);
  return useCallback((anahtarlar) => {
    (anahtarlar || []).forEach((a) => depo.surum.set(a, (depo.surum.get(a) || 0) + 1));
    depo.dinleyici.forEach((fn) => fn(anahtarlar));
  }, [depo]);
}

export function useVeri(anahtar, getir, { odaktaYenile = true, etkin = true } = {}) {
  const depo = useContext(VeriBaglami);
  const [durum, setDurum] = useState(() => ({ veri: depo.onbellek.get(anahtar), hata: null, yukleniyor: !depo.onbellek.has(anahtar) }));
  const [yenileniyor, setYenileniyor] = useState(false);
  const getirRef = useRef(getir);
  getirRef.current = getir;
  const sira = useRef(0);
  const bagli = useRef(true);
  // Etki yeniden çalışırsa (Fast Refresh / StrictMode) bayrak geri açılır; yoksa yanıtlar sessizce atılır
  useEffect(() => { bagli.current = true; return () => { bagli.current = false; }; }, []);

  const yukle = useCallback(async (elle = false) => {
    if (!etkin) return;
    const benim = ++sira.current;
    if (elle) setYenileniyor(true);
    try {
      const veri = await getirRef.current();
      if (!bagli.current || benim !== sira.current) return;
      depo.onbellek.set(anahtar, veri);
      depo.zaman.set(anahtar, Date.now());
      setDurum({ veri, hata: null, yukleniyor: false });
    } catch (hata) {
      if (!bagli.current || benim !== sira.current) return;
      // Önceki başarılı veri varsa korunur ama hata da bildirilir (eski veri olduğu belli olsun)
      setDurum((d) => ({ veri: d.veri, hata, yukleniyor: false }));
    } finally {
      if (bagli.current && elle) setYenileniyor(false);
    }
  }, [anahtar, depo, etkin]);

  useEffect(() => { yukle(); }, [yukle]);

  useEffect(() => {
    const fn = (anahtarlar) => { if (anahtarlar.includes(anahtar)) yukle(); };
    depo.dinleyici.add(fn);
    return () => depo.dinleyici.delete(fn);
  }, [anahtar, depo, yukle]);

  const ilk = useRef(true);
  useFocusEffect(useCallback(() => {
    if (ilk.current) { ilk.current = false; return; }
    if (odaktaYenile) yukle();
  }, [odaktaYenile, yukle]));

  // zaman: son BAŞARILI yüklemenin anı (hata + eski veri gösterilirken ekrana yazılır)
  return { ...durum, zaman: depo.zaman.get(anahtar) || null, yenileniyor, yenile: () => yukle(true) };
}
