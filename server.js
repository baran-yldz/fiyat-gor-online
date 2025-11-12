// server.js
import express from "express";
import cors from "cors";
import crypto from "crypto";
import fetch from "node-fetch";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const PORT = 3000;

const API_BASE = process.env.API_BASE;
const apiUrl = process.env.SQL_API_URL || process.env.API_URL;
const firmaKodu = process.env.FIRMA_KODU;
const calismaYili = process.env.CALISMA_YILI;
const apiKey = process.env.API_KEY;
const kullaniciKodu = process.env.KULLANICI_KODU;
const firmaNo = process.env.FIRMA_NO;
const subeNo = process.env.SUBE_NO;
const dbsifre = process.env.SIFRE;

// ---------- helpers ----------
function generateDailyHash() {
  const sifre = dbsifre; // fallback sabit şifre (isteğe göre değiştir)
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Istanbul",
  });
  const tarih = formatter.format(new Date()); // yyyy-MM-dd
  const md5input = `${tarih} ${sifre}`; // boşluk önemli
  return crypto.createHash("md5").update(md5input).digest("hex");
}

// ---------- login (Sifre dışarıdan gelebilir) ----------
async function loginToAPI() {
  const loginUrl = `${API_BASE}/APILogin`;
  const sifre = generateDailyHash();

  // login body formatı talimatına göre
  const body = {
    FirmaKodu: firmaKodu,
    CalismaYili: calismaYili,
    ApiKey: apiKey,
    KullaniciKodu: kullaniciKodu,
    Sifre: sifre,
    FirmaNo: firmaNo,
    SubeNo: subeNo,
  };

  console.log("🔹 APILogin body:", { ...body });
  const resp = await fetch(loginUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  console.log("🔹 APILogin status:", resp.status);
  // debug: eğer gerekirse cevabı metin olarak logla
  if (resp.status !== 200) {
    const txt = await resp.text().catch(() => "<no-body>");
    console.error("❌ APILogin cevap (non-200):", resp.status, txt);
    throw new Error(`Login başarısız: ${resp.status}`);
  }

  // login 200 ise yeterli (token yok)
  return true;
}

app.post("/getProduct", async (req, res) => {
  try {
    const { barcode } = req.body; // 👈 barcode burada tanımlı

    console.log("🔹 İstek alındı, barkod:", barcode);

    const sifre = generateDailyHash();

    const sqlQueryBase = `
SELECT DISTINCT M.stok_kodu, T.stok_isim, T.barkod, T.birim, M.depo_kodu, D.dep_adi AS depo_adi, ISNULL(T.fiyat, 0) AS fiyat, ISNULL(M.MevcutMiktar, 0) AS MevcutMiktar FROM (SELECT H.sth_stok_kod AS stok_kodu, CASE WHEN H.sth_tip IN (0,2) THEN H.sth_giris_depo_no WHEN H.sth_tip = 1 THEN H.sth_cikis_depo_no END AS depo_kodu, SUM(CASE WHEN (H.sth_tip = 0) OR ((H.sth_tip = 2) AND (H.sth_giris_depo_no <> H.sth_cikis_depo_no)) AND (H.sth_giris_depo_no IS NOT NULL) THEN H.sth_miktar WHEN (H.sth_tip = 1) OR ((H.sth_tip = 2) AND (H.sth_giris_depo_no <> H.sth_cikis_depo_no)) AND (H.sth_cikis_depo_no IS NOT NULL) THEN -H.sth_miktar ELSE 0 END) AS MevcutMiktar FROM STOK_HAREKETLERI AS H WITH (NOLOCK) WHERE (NOT (H.sth_cins IN (9,15))) GROUP BY H.sth_stok_kod, CASE WHEN H.sth_tip IN (0,2) THEN H.sth_giris_depo_no WHEN H.sth_tip = 1 THEN H.sth_cikis_depo_no END) AS M LEFT JOIN (SELECT STOKLAR.sto_kod AS stok_kodu, STOKLAR.sto_isim AS stok_isim, (SELECT TOP 1 bar_kodu FROM BARKOD_TANIMLARI WHERE bar_stokkodu = STOKLAR.sto_kod ORDER BY bar_kodu) AS barkod, STOK_SATIS_FIYAT_LISTELERI.sfiyat_birim_pntr AS birim, STOK_SATIS_FIYAT_LISTELERI.sfiyat_fiyati AS fiyat, STOK_SATIS_FIYAT_LISTELERI.sfiyat_deposirano AS deposirano FROM STOKLAR JOIN STOK_SATIS_FIYAT_LISTELERI ON STOK_SATIS_FIYAT_LISTELERI.sfiyat_stokkod = STOKLAR.sto_kod) AS T ON M.stok_kodu = T.stok_kodu AND M.depo_kodu = T.deposirano LEFT JOIN DEPOLAR AS D ON M.depo_kodu = D.dep_no WHERE T.barkod = '075656016804' OR M.stok_kodu = (SELECT bar_stokkodu FROM BARKOD_TANIMLARI WHERE bar_kodu = '@BARCODE@')
`;

    // 👇 barcode'u güvenli şekilde sorguya ekle
    const sqlQuery = sqlQueryBase.replace(
      "@BARCODE@",
      barcode.replace(/'/g, "''")
    );

    const sqlBody = {
      Mikro: {
        FirmaKodu: firmaKodu,
        CalismaYili: calismaYili,
        ApiKey: apiKey,
        KullaniciKodu: kullaniciKodu,
        Sifre: sifre,
        FirmaNo: firmaNo,
        SubeNo: subeNo,
      },
      SQLSorgu: sqlQuery,
    };

    const url = apiUrl;

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        Connection: "close",
      },
      body: JSON.stringify(sqlBody),
    });

    const data = await response.json();
    console.log("🔸 API yanıtı:", data);

    if (!data || data.result?.[0]?.IsError) {
      console.error(
        "❌ Mikro API hata:",
        data.result?.[0]?.ErrorMessage || "Bilinmeyen hata"
      );
      return res
        .status(500)
        .json({ error: data.result?.[0]?.ErrorMessage || "Mikro API hatası" });
    }

    res.json(data);
  } catch (err) {
    console.error("💥 Hata:", err);
    res.status(500).json({ error: err.message });
  }
});

// ✅ Güvenli environment test endpoint
app.get("/env-test", (req, res) => {
  const mask = (v) =>
    v ? v.slice(0, 5) + "...(" + v.length + " chars)" : "undefined";

  res.json({
    API_BASE: mask(process.env.API_BASE),
    SQL_API_URL: mask(process.env.SQL_API_URL || process.env.API_URL),
    API_KEY: mask(process.env.API_KEY),
    FIRMA_KODU: process.env.FIRMA_KODU || "undefined",
    CALISMA_YILI: process.env.CALISMA_YILI || "undefined",
    KULLANICI_KODU: process.env.KULLANICI_KODU || "undefined",
    FIRMA_NO: process.env.FIRMA_NO || "undefined",
    SUBE_NO: process.env.SUBE_NO || "undefined",
  });
});

app.listen(PORT, async () => {
  console.log(`✅ Server çalışıyor: http://localhost:${PORT}/getProduct`);
  try {
    await loginToAPI(); // 👈 Sunucu ayağa kalkınca bir kere çalışacak
  } catch (err) {
    console.error("⚠️ Startup login başarısız:", err);
  }
});
