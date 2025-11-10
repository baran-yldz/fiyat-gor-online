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
const apiUrl = process.env.SQL_API_URL;
const firmaKodu = process.env.FIRMA_KODU;
const calismaYili = process.env.CALISMA_YILI;
const apiKey = process.env.API_KEY;
const kullaniciKodu = process.env.KULLANICI_KODU;
const firmaNo = process.env.FIRMA_NO;
const subeNo = process.env.SUBE_NO;
const dbsifre  = process.env.SIFRE;

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

    const sqlQueryBase = `SELECT T.stok_kodu, T.stok_isim, T.barkod, T.birim, T.fiyat, T.deposirano, ISNULL(M.MevcutMiktar, 0) AS MevcutMiktar FROM ( SELECT STOKLAR.sto_kod AS stok_kodu,
                          STOKLAR.sto_isim AS stok_isim, BARKOD_TANIMLARI.bar_kodu AS barkod,
                          STOK_SATIS_FIYAT_LISTELERI.sfiyat_birim_pntr AS birim,
                          STOK_SATIS_FIYAT_LISTELERI.sfiyat_fiyati AS fiyat,
                          STOK_SATIS_FIYAT_LISTELERI.sfiyat_deposirano AS deposirano
                          FROM BARKOD_TANIMLARI
                          JOIN STOKLAR ON BARKOD_TANIMLARI.bar_stokkodu = STOKLAR.sto_kod
                          JOIN STOK_SATIS_FIYAT_LISTELERI ON STOK_SATIS_FIYAT_LISTELERI.sfiyat_stokkod = STOKLAR.sto_kod
                          ) AS T
                          LEFT JOIN (
                            SELECT 
                              H.sth_stok_kod AS stok_kodu,
                              SUM(CASE 
                                WHEN H.sth_tip IN (0,2) THEN H.sth_miktar
                                WHEN H.sth_tip = 1 THEN -H.sth_miktar
                                ELSE 0 
                              END) AS MevcutMiktar
                            FROM [dbo].[STOK_HAREKETLERI] AS H
                            GROUP BY H.sth_stok_kod
                          ) AS M
                          ON T.stok_kodu = M.stok_kodu
                          WHERE T.barkod = '@BARCODE@'
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

    const apiUrl = apiUrl;

    const response = await fetch(apiUrl, {
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

app.listen(PORT, async () => {
  console.log(`✅ Server çalışıyor: http://localhost:${PORT}/getProduct`);
  try {
    await loginToAPI(); // 👈 Sunucu ayağa kalkınca bir kere çalışacak
  } catch (err) {
    console.error("⚠️ Startup login başarısız:", err);
  }
});
