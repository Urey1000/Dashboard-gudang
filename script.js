// ========================================
// DASHBOARD GUDANG - V10.2 PRO (PATCHED & SECURED)
// ========================================

// ================================
// CONSTANTS & UTILITIES
// ================================
const DEFAULT_MERK = [
    { id: "ID SMP 001", nama: "Unilever" },
    { id: "ID SMP 002", nama: "Mayora" },
    { id: "ID SMP 003", nama: "Wings Food" },
    { id: "ID SMP 004", nama: "Orang Tua" },
    { id: "ID SMP 005", nama: "Faber Castell" }
];

const safeLoad = (key) => {
    try {
        const d = localStorage.getItem(key);
        return d ? JSON.parse(d) : [];
    } catch {
        return [];
    }
};

// FIX 2: Mencegah angka negatif pada harga/input nominal
const safeNumber = (v) => {
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? n : 0; 
};

const safeString = (v) => (v || "").toString().trim();

// FIX 1: Membiarkan kalkulasi minus agar selisih stok ketahuan saat audit
const calcStock = (a, m, k) => a + m - k;

const nowTime = () => new Date().toISOString();

const formatRupiah = (n) => `Rp ${safeNumber(n).toLocaleString("id-ID")}`;

const formatDate = (d) => d ? new Date(d).toLocaleString("id-ID") : "-";

// FIX 3: Sanitasi XSS untuk mencegah eksekusi script berbahaya dari input user
const escapeHTML = (str) => safeString(str).replace(/[&<>'"]/g, 
    tag => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        "'": '&#39;',
        '"': '&quot;'
    }[tag] || tag)
);

// FIX 4: ID Generator yang jauh lebih aman dari tabrakan (Collision-resistant)
const generateId = () => crypto?.randomUUID?.() || (Date.now().toString(36) + Math.random().toString(36).substr(2, 5));

// ================================
// STATE
// ================================
let modeEditId = null;
let dataStockGudang = safeLoad("dataStockGudang");
let dataMovement = safeLoad("dataMovement");
const ledgerCache = new Map();

// ================================
// STORAGE
// ================================
function saveDB() {
    try {
        localStorage.setItem("dataStockGudang", JSON.stringify(dataStockGudang));
        localStorage.setItem("dataMovement", JSON.stringify(dataMovement));
        return true;
    } catch (e) {
        // FIX 5: Rollback state jika storage penuh agar UI dan Database tidak desync (tidak sinkron)
        alert("CRITICAL ERROR: Storage browser penuh! Data gagal disimpan. Memuat ulang data terakhir...");
        dataStockGudang = safeLoad("dataStockGudang");
        dataMovement = safeLoad("dataMovement");
        invalidateLedger();
        scheduleRender();
        return false;
    }
}

// ================================
// CACHE LEDGER
// ================================
function getStockStats(stockId) {
    if (ledgerCache.has(stockId)) return ledgerCache.get(stockId);

    let a = 0, m = 0, k = 0, last = null;

    for (const x of dataMovement) {
        if (x.stockId !== stockId) continue;

        if (x.type === "AWAL") a += x.qty;
        if (x.type === "IN") m += x.qty;
        if (x.type === "OUT") k += x.qty;

        if (!last || new Date(x.date) > new Date(last)) last = x.date;
    }

    const res = {
        awal: a,
        masuk: m,
        keluar: k,
        stok: calcStock(a, m, k),
        lastUpdate: last
    };

    ledgerCache.set(stockId, res);
    return res;
}

function invalidateLedger(id) {
    if (id) ledgerCache.delete(id);
    else ledgerCache.clear();
}

// ================================
// MOVEMENT
// ================================
function catatMovement(id, type, qty) {
    if (qty <= 0) return;

    dataMovement.push({
        id: generateId(), // Menggunakan FIX 4
        stockId: id,
        type,
        qty,
        date: nowTime()
    });

    invalidateLedger(id);
    saveDB();
}

// ================================
// INPUT QTY SAFE
// ================================
function inputQty(msg) {
    const r = prompt(msg);
    if (r === null) return null;

    const q = Number(r);
    if (!Number.isInteger(q) || q <= 0) {
        alert("Harus berupa angka bulat dan lebih dari 0");
        return null;
    }
    return q;
}

// ================================
// STOCK ACTION
// ================================
window.openStockIn = (id) => {
    const q = inputQty("Masukkan jumlah barang MASUK:");
    if (q) {
        catatMovement(id, "IN", q);
        scheduleRender();
    }
};

window.openStockOut = (id) => {
    const s = getStockStats(id);
    const q = inputQty(`Masukkan jumlah barang KELUAR (Stok saat ini: ${s.stok})`);
    if (q === null) return;

    if (q > s.stok) return alert("Stok tidak mencukupi!");

    catatMovement(id, "OUT", q);
    scheduleRender();
};

// ================================
// MERK MANAGEMENT
// ================================
function seedMerkIfEmpty() {
    const exists = localStorage.getItem("seedMerkDone");
    if (!exists) {
        localStorage.setItem("seedMerkDone", "1");
        console.log("Seed merk pertama kali aktif");
    }
}

function safeFetchMerk() {
    return fetch("./app.json")
        .then(r => r.ok ? r.json() : null)
        .catch(() => null);
}

async function muatDataMerk() {
    seedMerkIfEmpty();
    const select = document.getElementById("inputMerk");
    if (!select) return;

    select.innerHTML = `<option value="">-- Pilih Merk --</option>`;

    let data = null;

    try {
        const json = await safeFetchMerk();
        if (json && json.merkDagang) {
            data = json.merkDagang;
        }
    } catch (e) {
        console.warn("Gagal parse data app.json");
    }

    if (!Array.isArray(data) || data.length === 0) {
        console.warn("Menggunakan DEFAULT_MERK");
        data = DEFAULT_MERK;
    }

    data.forEach(m => {
        const opt = document.createElement("option");
        opt.value = `${m.id}|${m.nama}`;
        opt.textContent = `${m.id} - ${m.nama}`;
        select.appendChild(opt);
    });
}

// ================================
// JOIN DATA (OPTIMIZED)
// ================================
function getJoinedData() {
    const key = safeString(val("inputSearch")).toLowerCase();
    const period = val("filterPeriode") || "semua";

    let res = [];

    for (const item of dataStockGudang) {
        if (!item?.id) continue;

        const s = getStockStats(item.id);
        const merged = { ...item, ...s };

        const d = new Date(merged.lastUpdate || merged.createdAt || new Date());
        const now = new Date();

        let ok = true;

        if (period === "harian") ok = d.toDateString() === now.toDateString();
        else if (period === "mingguan") ok = (now - d) <= 7 * 86400000;
        else if (period === "bulanan") ok = d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
        else if (period === "tahunan") ok = d.getFullYear() === now.getFullYear();

        if (!ok) continue;

        if (key) {
            const blob = `${item.idMerk}${item.namaMerk}${item.namaBarang}${item.ukuran}`.toLowerCase();
            if (!blob.includes(key)) continue;
        }

        res.push(merged);
    }

    return res;
}

// ================================
// DEBOUNCE RENDER
// ================================
let renderTimer = null;

function scheduleRender() {
    clearTimeout(renderTimer);
    renderTimer = setTimeout(() => {
        requestAnimationFrame(renderTabel);
    }, 80);
}

// ================================
// RENDER
// ================================
function renderTabel() {
    const tbody = document.getElementById("isiTabel");
    if (!tbody) return;

    const data = getJoinedData();

    let html = "";
    let ts = 0, tm = 0, tk = 0, tn = 0;

    data.forEach((b, i) => {
        const nilai = b.stok * safeNumber(b.harga);

        ts += b.stok;
        tm += b.masuk;
        tk += b.keluar;
        tn += nilai;

        // FIX 1 Lanjutan: Penanda visual jika stok minus (indikasi kebocoran/error)
        const status =
            b.stok < 0 ? "🚨 SELISIH (MINUS)" :
            b.stok === 0 ? "❌ Habis" :
            b.stok < 5 ? "⚠️ Menipis" : "✅ Aman";

        // FIX 3 Lanjutan: Terapkan escapeHTML pada semua data teks inputan pengguna
        html += `
<tr>
    <td>${i + 1}</td>
    <td>${escapeHTML(b.idMerk) || "-"}</td>
    <td>${escapeHTML(b.namaMerk) || "-"}</td>
    <td>${escapeHTML(b.namaBarang) || "-"}</td>
    <td>${escapeHTML(b.ukuran) || "-"}</td>
    <td>${formatRupiah(b.harga)}</td>
    <td>${b.awal}</td>
    <td>${b.masuk}</td>
    <td>${b.keluar}</td>
    <td style="${b.stok < 0 ? 'color: red;' : ''}"><b>${b.stok}</b><br><small>${status}</small></td>
    <td>${formatRupiah(nilai)}</td>
    <td>${formatDate(b.lastUpdate || b.createdAt)}</td>
    <td>
        <button onclick="openStockIn('${b.id}')">+IN</button>
        <button onclick="openStockOut('${b.id}')">-OUT</button>
        <button onclick="editData('${b.id}')">Edit</button>
        <button onclick="hapusData('${b.id}')">Hapus</button>
    </td>
</tr>`;
    });

    tbody.innerHTML = html;

    setText("sumTotalItem", data.length);
    setText("sumTotalStok", ts);
    setText("sumTotalMasuk", tm);
    setText("sumTotalKeluar", tk);
    setText("sumTotalNilai", formatRupiah(tn));
}

// ================================
// HELPERS DOM
// ================================
function val(id) {
    return document.getElementById(id)?.value?.trim() || "";
}

function num(id) {
    return safeNumber(val(id));
}

function setText(id, v) {
    const el = document.getElementById(id);
    if (el) el.textContent = v;
}

// ================================
// CRUD (FORM SUBMIT, EDIT, DELETE)
// ================================
window.handleSubmit = (e) => {
    e.preventDefault();
    
    const merkVal = val("inputMerk").split("|");
    const idMerk = merkVal[0] || "UMUM";
    const namaMerk = merkVal[1] || "Umum";
    
    const namaBarang = val("inputBarang");
    const ukuran = val("inputUkuran");
    const harga = num("inputHarga");
    const stokAwal = num("inputAwal");

    if (!namaBarang) return alert("Nama barang tidak boleh kosong!");

    if (modeEditId) {
        const idx = dataStockGudang.findIndex(x => x.id === modeEditId);
        if (idx > -1) {
            dataStockGudang[idx] = { 
                ...dataStockGudang[idx], 
                idMerk, namaMerk, namaBarang, ukuran, harga 
            };
        }
        modeEditId = null;
    } else {
        const newId = generateId(); // Menggunakan FIX 4
        dataStockGudang.push({
            id: newId,
            idMerk,
            namaMerk,
            namaBarang,
            ukuran,
            harga,
            createdAt: nowTime()
        });
        
        if (stokAwal > 0) {
            catatMovement(newId, "AWAL", stokAwal);
        }
    }

    saveDB();
    invalidateLedger();
    scheduleRender();
    e.target.reset(); 
};

window.editData = (id) => {
    const data = dataStockGudang.find(x => x.id === id);
    if (!data) return alert("Data tidak ditemukan!");
    
    modeEditId = id;
    
    const merkInput = document.getElementById("inputMerk");
    if (merkInput) merkInput.value = `${data.idMerk}|${data.namaMerk}`;
    
    const namaInput = document.getElementById("inputBarang");
    if (namaInput) namaInput.value = data.namaBarang; // Tidak perlu escape saat dikembalikan ke input form, browser menanganinya
    
    const ukuranInput = document.getElementById("inputUkuran");
    if (ukuranInput) ukuranInput.value = data.ukuran;
    
    const hargaInput = document.getElementById("inputHarga");
    if (hargaInput) hargaInput.value = data.harga;

    const awalInput = document.getElementById("inputAwal");
    if (awalInput) {
        awalInput.value = "";
        awalInput.disabled = true; 
        awalInput.placeholder = "Disable (Mode Edit)";
    }
};

window.hapusData = (id) => {
    if (!confirm("Yakin ingin menghapus data ini beserta histori pergerakannya?")) return;

    dataStockGudang = dataStockGudang.filter(x => x.id !== id);
    dataMovement = dataMovement.filter(x => x.stockId !== id);

    invalidateLedger();
    saveDB();
    scheduleRender();
};

window.resetERP = () => {
    if (!confirm("BAHAYA: Reset semua data aplikasi? Aksi ini tidak dapat dibatalkan!")) return;

    localStorage.removeItem("dataStockGudang");
    localStorage.removeItem("dataMovement");
    localStorage.removeItem("seedMerkDone");

    dataStockGudang = [];
    dataMovement = [];
    invalidateLedger();

    scheduleRender();
};

// ================================
// INIT
// ================================
async function initERP() {
    console.log("V10.2 PRO ERP INIT - STARTED (PATCHED)");

    await muatDataMerk(); 
    renderTabel();

    const form = document.getElementById("formInputStock");
    if (form && !form.dataset.bound) {
        form.addEventListener("submit", handleSubmit);
        form.dataset.bound = "1";
    }

    document.getElementById("inputSearch")?.addEventListener("input", scheduleRender);
    document.getElementById("filterPeriode")?.addEventListener("change", scheduleRender);
}

if (!window.__ERP_INIT__) {
    window.__ERP_INIT__ = true;
    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", initERP);
    } else {
        initERP();
    }
}

