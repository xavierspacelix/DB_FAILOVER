# Manual Test — Sisa 5 Test Case

**PG-HA Cluster | 15 July 2026**  
**Tester:** Juan Akbar

---

## Prasyarat

- Sudah login ke **Node D** (10.30.110.128) sebagai root/kbbadmin
- Cluster normal: **Node D = Leader**, **Node E = Replica**
- Sudah jalankan TC-01 s.d. TC-11 sukses
- Data table `qa_test` sudah ada (dari TC-05) atau buat ulang:

```bash
psql -h 10.30.110.112 -U groupware -d nama_database -c "
  CREATE TABLE IF NOT EXISTS qa_test (id serial, name text);
  INSERT INTO qa_test (name) VALUES ('test1'),('test2');
"
```

### Credential Refs

| User | Password | Dipakai di |
|------|----------|-----------|
| `root` | (sesuai input) | SSH ke semua node |
| `kbbadmin` | (sesuai input) | SSH ke Node D (10.30.110.128) jika berbeda |
| `groupware` | `KBBgroupware@2025!)` | Koneksi DB via VIP |
| `postgres` | `postgres_pass` | Superuser lokal |

---

## TC-12: etcd Quorum — 1 Node Down (Positive)

**Tujuan:** Verifikasi cluster etcd tetap sehat walau 1 node mati.

### Steps

```bash
# 1. Cek health etcd awal
ssh root@10.30.110.114 "sudo etcdctl endpoint health --cluster -w table"
# Expected: 3/3 sehat
```

**Hasil actual:** `_________________`

```bash
# 2. Stop etcd di Node C (10.30.110.116)
ssh root@10.30.110.116 "sudo systemctl stop etcd"
```

**3. Tunggu 5 detik, lalu cek health:**
```bash
ssh root@10.30.110.114 "sudo etcdctl endpoint health --cluster -w table"
# Expected: 2/3 sehat (Node A & B UP, Node C DOWN)
# Cluster etcd masih bisa write
```

**Hasil actual:** `_________________`

```bash
# 4. Verifikasi Patroni masih sehat
sudo patronictl -c /etc/patroni/patroni.yml list
# Expected: node-d Leader, node-e Replica — running
```

**Hasil actual:** `_________________`

```bash
# 5. Koneksi DB via VIP masih jalan
psql -h 10.30.110.112 -U groupware -d nama_database -c "SELECT 1 AS test;"
# Expected: return 1
```

**Hasil actual:** `_________________`

```bash
# 6. Masih bisa write (etcd masih punya quorum)
psql -h 10.30.110.112 -U groupware -d nama_database -c "
  INSERT INTO qa_test (name) VALUES ('tc12_test');
  SELECT COUNT(*) AS n FROM qa_test;
"
# Expected: INSERT sukses, count nambah
```

**Hasil actual:** `_________________`

```bash
# 7. Kembalikan etcd Node C
ssh root@10.30.110.116 "sudo systemctl start etcd"
sleep 5
ssh root@10.30.110.114 "sudo etcdctl endpoint health --cluster -w table"
# Expected: 3/3 sehat kembali
```

**Hasil actual:** `_________________`

### Verdict
☐ **PASS** — etcd toleran 1 node failure  
☐ **FAIL** — (catat detail error)

**Catatan:** `_________________`

---

## TC-13: etcd Quorum — 2 Node Down (Negative)

**Tujuan:** Verifikasi cluster etcd **read-only** saat kehilangan quorum (2 node mati).

### Steps

```bash
# 1. Cek health etcd awal
ssh root@10.30.110.114 "sudo etcdctl endpoint health --cluster -w table"
# Expected: 3/3 sehat
```

**Hasil actual:** `_________________`

```bash
# 2. Stop etcd di 2 node sekaligus
ssh root@10.30.110.115 "sudo systemctl stop etcd"
ssh root@10.30.110.116 "sudo systemctl stop etcd"
sleep 5
```

```bash
# 3. Cek health — harus FAIL (quorum loss)
ssh root@10.30.110.114 "sudo etcdctl endpoint health --cluster -w table 2>&1 || true"
# Expected: error atau 1/3 sehat (hanya Node A yang hidup)
```

**Hasil actual:** `_________________`

```bash
# 4. Cek Patroni — harus terpengaruh
sudo patronictl -c /etc/patroni/patroni.yml list 2>&1 || true
# Expected: error koneksi atau cluster tidak normal karena etcd read-only
```

**Hasil actual:** `_________________`

```bash
# 5. Cek koneksi DB via VIP — diharapkan GAGAL
psql -h 10.30.110.112 -U groupware -d nama_database -c "SELECT 1;" 2>&1 || true
# Expected: FATAL / Connection refused (Patroni tidak bisa tentukan Leader)
```

**Hasil actual:** `_________________`

### Verdict
☐ **PASS** — etcd read-only sesuai harapan (negative test)  
☐ **FAIL** — masih bisa write (berarti etcd tidak benar-benar quorum loss)

**Catatan:** `_________________`

---

## TC-14: etcd Recovery dari Quorum Loss (Positive)

**Tujuan:** Verifikasi cluster pulih total setelah quorum loss.

### Steps

```bash
# 1. Start etcd di Node B dan C
ssh root@10.30.110.115 "sudo systemctl start etcd"
ssh root@10.30.110.116 "sudo systemctl start etcd"
sleep 10
```

```bash
# 2. Cek health — harus pulih
ssh root@10.30.110.114 "sudo etcdctl endpoint health --cluster -w table"
# Expected: 3/3 sehat
```

**Hasil actual:** `_________________`

```bash
# 3. Cek Patroni — harus recover otomatis (tunggu ~15-30 detik)
sudo patronictl -c /etc/patroni/patroni.yml list
# Expected: node-d Leader, node-e Replica — running
```

**Hasil actual:** `_________________`

```bash
# 4. Koneksi DB via VIP — harus pulih
psql -h 10.30.110.112 -U groupware -d nama_database -c "SELECT 1 AS recovery_ok;"
# Expected: return 1
```

**Hasil actual:** `_________________`

```bash
# 5. Data masih utuh
psql -h 10.30.110.112 -U groupware -d nama_database -c "SELECT COUNT(*) AS n FROM qa_test;"
# Expected: data masih ada (minimal 2 row dari TC-05)
```

**Hasil actual:** `_________________`

### Verdict
☐ **PASS** — cluster pulih total setelah quorum loss  
☐ **FAIL** — (catat detail error)

**Catatan:** `_________________`

---

## TC-15: VIP Movement — MASTER Down (Positive)

**Tujuan:** Verifikasi VIP pindah otomatis ke BACKUP saat Keepalived MASTER mati.

### Steps

```bash
# 1. Cek VIP saat ini ada di Node A (MASTER)
ssh root@10.30.110.114 "sudo ip addr show | grep 10.30.110.112"
# Expected: VIP visible di Node A
```

**Hasil actual:** `_________________`

```bash
# 2. Stop keepalived di Node A (MASTER)
ssh root@10.30.110.114 "sudo systemctl stop keepalived"
sleep 5
```

```bash
# 3. Cek VIP sekarang ada di Node B (BACKUP)
ssh root@10.30.110.115 "sudo ip addr show | grep 10.30.110.112"
# Expected: VIP visible di Node B
```

**Hasil actual:** `_________________`

```bash
# 4. Verifikasi koneksi DB via VIP masih jalan
psql -h 10.30.110.112 -U groupware -d nama_database -c "SELECT 1 AS vip_test;"
# Expected: return 1 (VIP pindah, koneksi tetap jalan via HAProxy Node B)
```

**Hasil actual:** `_________________`

```bash
# 5. Data masih bisa diakses
psql -h 10.30.110.112 -U groupware -d nama_database -c "SELECT COUNT(*) AS n FROM qa_test;"
# Expected: data utuh
```

**Hasil actual:** `_________________`

```bash
# 6. Start keepalived kembali di Node A
ssh root@10.30.110.114 "sudo systemctl start keepalived"
sleep 5
```

```bash
# 7. Verifikasi VIP kembali ke Node A (priority lebih tinggi)
ssh root@10.30.110.114 "sudo ip addr show | grep 10.30.110.112"
ssh root@10.30.110.115 "sudo ip addr show | grep 10.30.110.112" || true
# Expected: VIP di Node A, TIDAK di Node B
```

**Hasil actual:** `_________________`

### Verdict
☐ **PASS** — VIP pindah ke BACKUP dan kembali ke MASTER  
☐ **FAIL** — (catat detail error)

**Catatan:** `_________________`

---

## TC-16: VIP Movement — MASTER Kembali (Positive)

**Catatan:** TC-16 sudah **otomatis terverifikasi** di step 6-7 TC-15.  
Jika ingin test terpisah:

```bash
# 1. Pastikan keepalived aktif di A dan B
ssh root@10.30.110.114 "sudo systemctl is-active keepalived"
ssh root@10.30.110.115 "sudo systemctl is-active keepalived"

# 2. Cek VIP di MASTER (Node A)
ssh root@10.30.110.114 "sudo ip addr show | grep 10.30.110.112"

# 3. Koneksi DB via VIP
psql -h 10.30.110.112 -U groupware -d nama_database -c "SELECT 1 AS vip_stable;"
```

### Verdict
☐ **PASS** — VIP stabil di MASTER  
☐ **FAIL** — (catat detail error)

---

## TC-18: Total Recovery — Semua Node Mati (Positive)

**⚠ WARNING:** Test ini **memadamkan semua service** di semua node.  
**Pastikan aplikasi tidak dipakai user!**

### A. Stop Semua Service (Urutan)

```bash
# 1. Stop Replica dulu (Node E)
ssh root@10.30.110.113 "sudo systemctl stop patroni"

# 2. Stop Leader (Node D)
sudo systemctl stop patroni

# 3. Stop Keepalived + HAProxy (Node A & B)
ssh root@10.30.110.114 "sudo systemctl stop keepalived haproxy"
ssh root@10.30.110.115 "sudo systemctl stop keepalived haproxy"

# 4. Stop etcd (Node A, B, C)
ssh root@10.30.110.114 "sudo systemctl stop etcd"
ssh root@10.30.110.115 "sudo systemctl stop etcd"
ssh root@10.30.110.116 "sudo systemctl stop etcd"
```

**Konfirmasi semua mati:**
```bash
ssh root@10.30.110.128 "sudo systemctl is-active patroni"  2>/dev/null || echo "dead (expected)"
ssh root@10.30.110.113 "sudo systemctl is-active patroni"  2>/dev/null || echo "dead (expected)"
ssh root@10.30.110.114 "sudo systemctl is-active etcd"     2>/dev/null || echo "dead (expected)"
ssh root@10.30.110.115 "sudo systemctl is-active etcd"     2>/dev/null || echo "dead (expected)"
ssh root@10.30.110.116 "sudo systemctl is-active etcd"     2>/dev/null || echo "dead (expected)"
# Expected: semua dead
```

### B. Start Semua Service (Urutan Wajib)

```bash
# 1. Start etcd di semua node — tunggu quorum
ssh root@10.30.110.114 "sudo systemctl start etcd"
ssh root@10.30.110.115 "sudo systemctl start etcd"
ssh root@10.30.110.116 "sudo systemctl start etcd"
sleep 5
ssh root@10.30.110.114 "sudo etcdctl endpoint health --cluster -w table"
# Expected: 3/3 sehat
```

**Hasil actual:** `_________________`

```bash
# 2. Start Patroni di Node D — akan jadi Leader
sudo systemctl start patroni
sleep 20
sudo patronictl -c /etc/patroni/patroni.yml list
# Expected: node-d = Leader (running)
```

**Hasil actual:** `_________________`

```bash
# 3. Start Patroni di Node E — akan join sebagai Replica
ssh root@10.30.110.113 "sudo systemctl start patroni"
sleep 30
sudo patronictl -c /etc/patroni/patroni.yml list
# Expected: node-d Leader, node-e Replica (running)
```

**Hasil actual:** `_________________`

```bash
# 4. Start HAProxy + Keepalived di Node A & B
ssh root@10.30.110.114 "sudo systemctl start haproxy keepalived"
ssh root@10.30.110.115 "sudo systemctl start haproxy keepalived"
sleep 10
```

### C. Verifikasi Final

```bash
# 1. Cek VIP
ssh root@10.30.110.114 "sudo ip addr show | grep 10.30.110.112"
# Expected: VIP di Node A
```

**Hasil actual:** `_________________`

```bash
# 2. Cek cluster
sudo patronictl -c /etc/patroni/patroni.yml list
# Expected: 
# node-d | 10.30.110.128 | Leader  | running
# node-e | 10.30.110.113 | Replica | running
```

**Hasil actual:** `_________________`

```bash
# 3. Koneksi DB via VIP
psql -h 10.30.110.112 -U groupware -d nama_database -c "SELECT 1 AS total_recovery;"
# Expected: return 1
```

**Hasil actual:** `_________________`

```bash
# 4. Cek pg_is_in_recovery (harus false — Leader)
psql -h 10.30.110.112 -U groupware -d nama_database -c "SELECT pg_is_in_recovery();"
# Expected: f
```

**Hasil actual:** `_________________`

```bash
# 5. Data intact
psql -h 10.30.110.112 -U groupware -d nama_database -c "SELECT COUNT(*) AS n FROM qa_test;"
# Expected: data masih ada
```

**Hasil actual:** `_________________`

```bash
# 6. Cek replikasi (data di Replica)
psql -h 10.30.110.113 -U groupware -d nama_database -c "SELECT COUNT(*) AS n FROM qa_test;"
# Expected: sama dengan hasil step 5
```

**Hasil actual:** `_________________`

### Verdict
☐ **PASS** — semua node recover total, data intact  
☐ **FAIL** — (catat detail error di step mana)

**Catatan:** `_________________`

---

## Ringkasan Hasil

| TC ID | Type | Description | Status |
|-------|------|-------------|--------|
| TC-12 | Positive | etcd quorum 1 node down | ☐ Pass / ☐ Fail |
| TC-13 | Negative | etcd quorum 2 nodes down | ☐ Pass / ☐ Fail |
| TC-14 | Positive | etcd recovery dari quorum loss | ☐ Pass / ☐ Fail |
| TC-15 | Positive | VIP movement MASTER down | ☐ Pass / ☐ Fail |
| TC-16 | Positive | VIP movement MASTER kembali | ☐ Pass / ☐ Fail |
| TC-18 | Positive | Total recovery semua node mati | ☐ Pass / ☐ Fail |

**Tester:** _________________  
**Date:** _________________  
**Notes:** `_________________`
