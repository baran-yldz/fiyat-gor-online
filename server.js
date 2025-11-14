// server.js
import express from "express";
import cors from "cors";
import crypto from "crypto";
import fetch from "node-fetch";
import dotenv from "dotenv";

dotenv.config();

const app = express();
// Güvenliğiniz için production'da CORS'u sadece uygulamanızın domainine kısıtlayın.
app.use(cors()); 
app.use(express.json());

const PORT = 3000;

// Env değişkenlerini tanımlayın
const API_BASE = process.env.API_BASE;
const apiUrl = process.env.SQL_API_URL || process.env.API_URL;
const firmaKodu = process.env.FIRMA_KODU;
const calismaYili = process.env.CALISMA_YILI;
const apiKey = process.env.API_KEY;
const kullaniciKodu = process.env.KULLANICI_KODU;
const firmaNo = process.env.FIRMA_NO;
const subeNo = process.env.SUBE_NO;
const dbsifre = process.env.SIFRE;

// 🔒 YENİ GÜVENLİK ANAHTARI (Sadece initialSync için)
const SECRET_SYNC_KEY = process.env.SECRET_SYNC_KEY; 

// ---------- helpers ----------
function generateDailyHash() {
    const sifre = dbsifre; 
    const formatter = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Europe/Istanbul",
    });
    const tarih = formatter.format(new Date()); // yyyy-MM-dd
    const md5input = `${tarih} ${sifre}`; 
    return crypto.createHash("md5").update(md5input).digest("hex");
}

/**
 * Mikro API'ye SQL sorgusu gönderir ve yanıtı işler.
 */
async function executeSqlQuery(sqlQuery) {
    const sifre = generateDailyHash();

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

    if (!data || data.result?.[0]?.IsError) {
        throw new Error(
            data.result?.[0]?.ErrorMessage || "Mikro API SQL sorgusu hatası"
        );
    }
    
    return data; 
}


// ----------------------------------------------------
// 🔒 GÜVENLİK MIDDLEWARE'İ
// ----------------------------------------------------
function restrictToSecretKey(req, res, next) {
    // 1. Secret Key tanımlı mı kontrol et
    if (!SECRET_SYNC_KEY) {
        console.warn("⚠️ SECRET_SYNC_KEY tanımlı değil. Güvenlik atlandı!");
        return next(); // Eğer env'de tanımlı değilse, geliştirme için atlayabiliriz.
    }

    // 2. Header'daki anahtarı al
    const clientKey = req.headers['x-secret-key'];

    // 3. Karşılaştır
    if (clientKey === SECRET_SYNC_KEY) {
        return next(); // Anahtar doğru, devam et
    }

    // 4. Hata döndür
    console.warn("❌ Yetkisiz erişim denemesi: /getAllProducts");
    return res.status(401).json({ error: "Yetkisiz Erişim (Invalid X-Secret-Key)" });
}

// ---------- login (Sunucu başlatılırken denenir) ----------
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

    console.log("🔹 APILogin deneniyor...");
    const resp = await fetch(loginUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    });

    console.log("🔹 APILogin status:", resp.status);
    if (resp.status !== 200) {
        const txt = await resp.text().catch(() => "<no-body>");
        console.error("❌ APILogin cevap (non-200):", resp.status, txt);
        throw new Error(`Login başarısız: ${resp.status}`);
    }

    return true;
}

// ------------------------------------------
// 🚀 UÇ NOKTA 1: Tekil Ürün Arama (Mevcut)
// ------------------------------------------
// Bu rotayı GET yerine POST tutmaya devam ediyoruz, çünkü body'de barkod bekliyor.
app.post("/getProduct", async (req, res) => {
    try {
        const { barcode } = req.body; 

        if (!barcode) {
            return res.status(400).json({ error: "Barkod zorunludur." });
        }
        
        console.log("🔹 İstek alındı, barkod:", barcode);

        // SQL Query'niz burada kalıyor... (Çok uzun olduğu için kesildi)
        const sqlQueryBase = `
            SELECT D.dep_no AS depo_kodu,D.dep_adi AS depo_adi,ISNULL(T.stok_kodu,'') AS stok_kodu,ISNULL(T.stok_isim,'') AS stok_isim,ISNULL(T.barkod,'') AS barkod,ISNULL(T.birim,'') AS birim,ISNULL(T.fiyat,0) AS 
            fiyat,ISNULL(T.son_degisim_tarihi,'1900-01-01') AS son_degisim_tarihi,ISNULL(T.olusturma_tarihi,'1900-01-01') AS olusturma_tarihi,ISNULL(M.MevcutMiktar,0) AS MevcutMiktar FROM 
            DEPOLAR D LEFT JOIN (SELECT S.sto_kod AS stok_kodu,S.sto_isim AS stok_isim,BT.bar_kodu AS barkod,FD.fid_birim_pntr AS birim,FD.fid_yenifiy_tutar AS fiyat,FD.fid_depo_no 
            AS depo_kodu,FD.fid_lastup_date AS son_degisim_tarihi,FD.fid_tarih AS olusturma_tarihi FROM STOKLAR S JOIN BARKOD_TANIMLARI BT ON BT.bar_stokkodu=S.sto_kod 
            JOIN STOK_FIYAT_DEGISIKLIKLERI FD ON FD.fid_stok_kod=S.sto_kod WHERE BT.bar_kodu IN (SELECT LTRIM(RTRIM(CAST(bar_kodu AS nvarchar(50)))) FROM BARKOD_TANIMLARI WHERE 
            LTRIM(RTRIM(CAST(bar_kodu AS nvarchar(50))))='@barcode@' UNION SELECT LTRIM(RTRIM(CAST(bar_kodu AS nvarchar(50)))) FROM BARKOD_TANIMLARI WHERE LTRIM(RTRIM(CAST(bar_kodu AS nvarchar(50)))) 
            LIKE '%@barcode@%')) AS T ON T.depo_kodu=D.dep_no LEFT JOIN (SELECT H.sth_stok_kod AS stok_kodu,CASE WHEN H.sth_tip IN (0,2) THEN H.sth_giris_depo_no WHEN H.sth_tip=1 THEN H.sth_cikis_depo_no 
            END AS depo_kodu,SUM(CASE WHEN (H.sth_tip=0) OR ((H.sth_tip=2) AND (H.sth_giris_depo_no IS NOT NULL)) THEN H.sth_miktar WHEN (H.sth_tip=1) OR ((H.sth_tip=2) AND (H.sth_cikis_depo_no IS NOT NULL)) 
            THEN -H.sth_miktar ELSE 0 END) AS MevcutMiktar FROM STOK_HAREKETLERI H WITH (NOLOCK) WHERE H.sth_stok_kod IN (SELECT bar_stokkodu FROM BARKOD_TANIMLARI WHERE 
            LTRIM(RTRIM(CAST(bar_kodu AS nvarchar(50))))='@barcode@' UNION SELECT bar_stokkodu FROM BARKOD_TANIMLARI WHERE LTRIM(RTRIM(CAST(bar_kodu AS nvarchar(50)))) LIKE '%@barcode@%') 
            GROUP BY H.sth_stok_kod,CASE WHEN H.sth_tip IN (0,2) THEN H.sth_giris_depo_no WHEN H.sth_tip=1 THEN H.sth_cikis_depo_no END) AS M ON M.stok_kodu=T.stok_kodu AND 
            M.depo_kodu=D.dep_no ORDER BY D.dep_no,T.olusturma_tarihi
            `;
        
        const safeBarcode = barcode.replace(/'/g, "''");

        const sqlQuery = sqlQueryBase.replace(
            new RegExp("@barcode@", "g"),
            safeBarcode
        );
        
        const data = await executeSqlQuery(sqlQuery);
        console.log("🔸 API yanıtı:", data.result?.[0]?.Data?.length || 0, "kayıt.");

        res.json(data);
    } catch (err) {
        console.error("💥 Hata:", err);
        res.status(500).json({ error: err.message });
    }
});


// ----------------------------------------------------
// 🚀 UÇ NOKTA 2: Tüm Ürünleri Çekme (Initial Sync)
// ----------------------------------------------------
// ❗ restrictToSecretKey middleware'i ile koruma altına alındı
app.post("/getAllProducts", restrictToSecretKey, async (req, res) => {
    try {
        console.log("🔹 '/getAllProducts' (yetkili) isteği alındı. Tüm stoklar çekiliyor...");
        
        // SQL Query'niz burada kalıyor... (Çok uzun olduğu için kesildi)
        const sqlQuery = `
            SELECT 
                D.dep_no AS depo_kodu,
                D.dep_adi AS depo_adi,
                S.sto_kod AS stok_kodu,
                S.sto_isim AS stok_isim,
                ISNULL(BT.bar_kodu, '') AS barkod, 
                S.sto_birim1_ad AS birim,           
                ISNULL(T_LAST.fiyat, 0) AS fiyat,           
                ISNULL(T_MAX.MaksimumFiyat, 0) AS MaksimumFiyat, 
                T_LAST.son_degisim_tarihi,
                T_LAST.olusturma_tarihi,
                ISNULL(M.MevcutMiktar, 0) AS MevcutMiktar
            FROM 
                STOKLAR S 
            LEFT JOIN 
                BARKOD_TANIMLARI BT ON S.sto_kod = BT.bar_stokkodu 
            CROSS JOIN 
                DEPOLAR D 
            LEFT JOIN (
                -- T_LAST: Her Depo/Stok için EN SON FİYATI Çekme
                SELECT 
                    FD.fid_stok_kod AS stok_kodu,
                    FD.fid_depo_no AS depo_kodu,
                    FD.fid_yenifiy_tutar AS fiyat,
                    FD.fid_lastup_date AS son_degisim_tarihi,
                    FD.fid_tarih AS olusturma_tarihi,
                    ROW_NUMBER() OVER (
                        PARTITION BY FD.fid_stok_kod, FD.fid_depo_no
                        ORDER BY FD.fid_tarih DESC, FD.fid_lastup_date DESC
                    ) AS rn
                FROM 
                    STOK_FIYAT_DEGISIKLIKLERI FD
            ) AS T_LAST ON T_LAST.stok_kodu = S.sto_kod 
                        AND T_LAST.depo_kodu = D.dep_no 
                        AND T_LAST.rn = 1 
            LEFT JOIN (
                -- T_MAX: Her Stok/Depo için MAKSİMUM FİYATI Çekme
                SELECT 
                    FD.fid_stok_kod AS stok_kodu,
                    FD.fid_depo_no AS depo_kodu,
                    MAX(FD.fid_yenifiy_tutar) AS MaksimumFiyat
                FROM 
                    STOK_FIYAT_DEGISIKLIKLERI FD
                GROUP BY 
                    FD.fid_stok_kod, FD.fid_depo_no
            ) AS T_MAX ON T_MAX.stok_kodu = S.sto_kod AND T_MAX.depo_kodu = D.depo_no
            LEFT JOIN (
                -- M: Stok Miktarını Depo Bazında Hesaplama
                SELECT 
                    H.sth_stok_kod AS stok_kodu,
                    CASE 
                        WHEN H.sth_tip IN (0, 2) THEN H.sth_giris_depo_no 
                        WHEN H.sth_tip = 1 THEN H.sth_cikis_depo_no 
                    END AS depo_kodu,
                    SUM(CASE 
                        WHEN (H.sth_tip = 0) OR (H.sth_tip = 2 AND H.sth_giris_depo_no IS NOT NULL) THEN H.sth_miktar 
                        WHEN (H.sth_tip = 1) OR (H.sth_tip = 2 AND H.sth_cikis_depo_no IS NOT NULL) THEN -H.sth_miktar 
                        ELSE 0 
                    END) AS MevcutMiktar
                FROM 
                    STOK_HAREKETLERI H WITH (NOLOCK)
                GROUP BY 
                    H.sth_stok_kod,
                    CASE WHEN H.sth_tip IN (0, 2) THEN H.sth_giris_depo_no WHEN H.sth_tip = 1 THEN H.sth_cikis_depo_no END
            ) AS M ON M.stok_kodu = S.sto_kod AND M.depo_kodu = D.dep_no
            ORDER BY 
                D.dep_no, S.sto_kod;
        `;
        
        const data = await executeSqlQuery(sqlQuery);
        console.log(`🔸 API yanıtı: ${data.result?.[0]?.Data?.length || 0} kayıt döndü.`);

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
        SECRET_SYNC_KEY: mask(process.env.SECRET_SYNC_KEY), // Yeni anahtar
        FIRMA_KODU: process.env.FIRMA_KODU || "undefined",
        CALISMA_YILI: process.env.CALISMA_YILI || "undefined",
        KULLANICI_KODU: process.env.KULLANICI_KODU || "undefined",
        FIRMA_NO: process.env.FIRMA_NO || "undefined",
        SUBE_NO: process.env.SUBE_NO || "undefined",
    });
});

app.listen(PORT, async () => {
    console.log(`✅ Server çalışıyor: http://localhost:${PORT}/`);
    console.log(`✅ Tekil Ürün POST: http://localhost:${PORT}/getProduct`);
    console.log(`✅ Tüm Ürünler POST (KORUMALI): http://localhost:${PORT}/getAllProducts`);
    try {
        await loginToAPI(); 
    } catch (err) {
        console.error("⚠️ Startup login başarısız:", err);
    }
});
