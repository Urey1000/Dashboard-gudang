// ========================================
// DASHBOARD GUDANG - V10.2 PRO (OPTIMIZED + SAFE)
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

const safeNumber = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
};

const safeString = (v) => (v || "").toString().trim();

const calcStock = (a, m, k) => Math.max(0, a + m - k);

const nowTime = () => new Date().toISOString();

const formatRupiah = (n) => `Rp ${safeNumber(n).toLocaleString("id-ID")}`;

const formatDate = (d) => d ? new Date(d).toLocaleString("id-ID") : "-";

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
    } catch {
        alert("Storage penuh / error saat menyimpan data!");
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
        id: crypto?.randomUUID?.() || Date.now().toString(),
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

    // FALLBACK OFFLINE JIKA GAGAL FETCH ATAU KOSONG
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

    console.log("Merk loaded:", data.length);
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

        // filter period
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

        const status =
            b.stok === 0 ? "❌ Habis" :
            b.stok < 5 ? "⚠️ Menipis" : "✅ Aman";

        html += `
<tr>
    <td>${i + 1}</td>
    <td>${b.idMerk || "-"}</td>
    <td>${b.namaMerk || "-"}</td>
    <td>${b.namaBarang || "-"}</td>
    <td>${b.ukuran || "-"}</td>
    <td>${formatRupiah(b.harga)}</td>
    <td>${b.awal}</td>
    <td>${b.masuk}</td>
    <td>${b.keluar}</td>
    <td><b>${b.stok}</b><br><small>${status}</small></td>
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
    
    // Asumsi input form ID yang digunakan: inputMerk, inputBarang, inputUkuran, inputHarga, inputAwal
    const merkVal = val("inputMerk").split("|");
    const idMerk = merkVal[0] || "UMUM";
    const namaMerk = merkVal[1] || "Umum";
    
    const namaBarang = val("inputBarang");
    const ukuran = val("inputUkuran");
    const harga = num("inputHarga");
    const stokAwal = num("inputAwal");

    if (!namaBarang) return alert("Nama barang tidak boleh kosong!");

    if (modeEditId) {
        // Mode Edit
        const idx = dataStockGudang.findIndex(x => x.id === modeEditId);
        if (idx > -1) {
            dataStockGudang[idx] = { 
                ...dataStockGudang[idx], 
                idMerk, namaMerk, namaBarang, ukuran, harga 
            };
        }
        modeEditId = null;
    } else {
        // Mode Tambah Baru
        const newId = crypto?.randomUUID?.() || Date.now().toString();
        dataStockGudang.push({
            id: newId,
            idMerk,
            namaMerk,
            namaBarang,
            ukuran,
            harga,
            createdAt: nowTime()
        });
        
        // Catat stok awal ke movement
        if (stokAwal > 0) {
            catatMovement(newId, "AWAL", stokAwal);
        }
    }

    saveDB();
    invalidateLedger();
    scheduleRender();
    e.target.reset(); // Reset form
};

window.editData = (id) => {
    const data = dataStockGudang.find(x => x.id === id);
    if (!data) return alert("Data tidak ditemukan!");
    
    modeEditId = id;
    
    // Asumsi ID input HTML sesuai dengan helper. Sesuaikan jika ID di HTML berbeda.
    const merkInput = document.getElementById("inputMerk");
    if (merkInput) merkInput.value = `${data.idMerk}|${data.namaMerk}`;
    
    const namaInput = document.getElementById("inputBarang");
    if (namaInput) namaInput.value = data.namaBarang;
    
    const ukuranInput = document.getElementById("inputUkuran");
    if (ukuranInput) ukuranInput.value = data.ukuran;
    
    const hargaInput = document.getElementById("inputHarga");
    if (hargaInput) hargaInput.value = data.harga;

    // Stok awal idealnya tidak bisa diedit saat mengubah data utama, agar pembukuan aman
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
    console.log("V10.2 PRO ERP INIT - STARTED");

    await muatDataMerk(); // ✔ WAJIB tunggu load data merk
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
