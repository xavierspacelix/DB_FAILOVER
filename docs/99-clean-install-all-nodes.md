# Clean Install — Reset Semua Node

> Prosedur untuk membersihkan seluruh data cluster dan memulai dari awal.
> Digunakan jika cluster bermasalah parah, atau ingin deploy ulang dari nol.
> Dokumentasi 2026: [etcd v3.6 recovery](https://etcd.io/docs/v3.6/op-guide/recovery/) • [Patroni 4.1](https://patroni.readthedocs.io/en/latest/)

---

## Urutan Eksekusi

Jalankan **berurutan** sesuai tabel. Jangan pernah bersamaan — urutan salah bisaebabkan data corrupt.

| Urutan | Node | Tindakan |
|--------|------|----------|
| 1 | **E** (.11) | Stop Patroni, hapus data PostgreSQL |
| 2 | **D** (.10) | Stop Patroni, hapus data PostgreSQL |
| 3 | **A, B, C** | Stop etcd, hapus data etcd |
| 4 | **A, B** | Stop HAProxy + Keepalived |
| 5 | **Semua** | Hapus repo lokal, log, dsb |
| 6 | **A, B, C** | Start ulang etcd cluster |
| 7 | **D** (.10) | Start Patroni sebagai Leader |
| 8 | **E** (.11) | Start Patroni sebagai Replica |
| 9 | **A, B** | Start HAProxy + Keepalived |

---

## Langkah-langkah

### 1. Node E (10.30.110.113) — Hapus Replica

```bash
systemctl stop patroni

# Hapus data PostgreSQL
rm -rf /var/lib/pgsql/16/data

# Hapus status Patroni
rm -f /var/lib/pgsql/patroni*

# Nonaktifkan service agar tidak auto-start
systemctl disable patroni
```

### 2. Node D (10.30.110.128) — Hapus Leader

```bash
systemctl stop patroni

# Cek apakah masih ada koneksi replikasi
psql -U postgres -c "SELECT * FROM pg_stat_replication;"

# Hapus data PostgreSQL
rm -rf /var/lib/pgsql/16/data

# Hapus status Patroni
rm -f /var/lib/pgsql/patroni*

systemctl disable patroni
```

### 3. Node A, B, C (10.30.110.114–14) — Hapus etcd Cluster

Jalankan di **ketiga node**:

```bash
systemctl stop etcd

# Hapus data etcd (membersihkan quorum)
rm -rf /var/lib/etcd/default.etcd/member

# Hapus file konfigurasi lama (opsional — biarkan .conf tetap ada)
# rm -f /etc/etcd/etcd.conf

systemctl disable etcd
```

> **Penting:** Semua node etcd harus stop sebelum lanjut. Jika hanya sebagian, cluster tetap anggap quorum ada dan data bisa corrupt.

### 4. Node A & B (10.30.110.114, .13) — Hapus Load Balancer

```bash
systemctl stop haproxy keepalived
systemctl disable haproxy keepalived
```

### 5. Semua Node — Bersihkan Sisa

```bash
# Hapus repo lokal
rm -f /etc/yum.repos.d/local-offline.repo

# Hapus log instalasi
rm -f /home/kbbadmin/install.log /home/kbbadmin/pgha-offline-bundle-10-Jul-2026.tar.gz 2>/dev/null

# Hapus direktori data postgres jika masih ada
rm -rf /var/lib/pgsql/16/data /tmp/pgpass /etc/patroni 2>/dev/null
```

---

## Re-Install

### 6. Start etcd Cluster (Node A, B, C — bersamaan)

Setelah data etcd dibersihkan, `ETCD_INITIAL_CLUSTER_STATE=new` sudah benar di konfigurasi. Start bersamaan:

```bash
# Jalankan simultan di A, B, C
systemctl enable --now etcd

# Verifikasi
etcdctl endpoint health --cluster
# Semua endpoint harus sehat, quorum tercapai (3/3)
```

### 7. Start Patroni — Node D (Leader)

```bash
systemctl enable --now patroni

# Verifikasi
patronictl -c /etc/patroni/patroni.yml list
# Harus muncul node-d sebagai Leader
```

### 8. Start Patroni — Node E (Replica)

```bash
systemctl enable --now patroni

# Verifikasi
patronictl -c /etc/patroni/patroni.yml list
# node-e akan muncul sebagai Replica setelah selesai clone
```

### 9. Start HAProxy + Keepalived — Node A & B

```bash
systemctl enable --now haproxy keepalived

# Verifikasi
ip addr show | grep 10.30.110.112
# VIP harus aktif di Node A (MASTER)
```

---

## Verifikasi Final

```bash
# Dari node mana pun
psql -h 10.30.110.112 -p 5432 -U postgres -c "SELECT pg_is_in_recovery();"
# false = terhubung ke Master

psql -h 10.30.110.112 -p 5432 -U postgres -c "\l"
# Harus muncul daftar database default
```

---

## Troubleshooting Clean Install

### etcd gagal start — "member already exists"
```bash
# Hapus sisa data member
rm -rf /var/lib/etcd/default.etcd/member
# Verifikasi ETCD_INITIAL_CLUSTER_STATE=new di /etc/etcd/etcd.conf
systemctl start etcd
```

### Patroni gagal — "data directory already exists"
```bash
# Hapus paksa data directory
rm -rf /var/lib/pgsql/16/data
systemctl restart patroni
```

### VIP tidak muncul
```bash
# Cek status keepalived
systemctl status keepalived
journalctl -u keepalived --no-pager -n 20

# Pastikan HAProxy jalan (track_script)
systemctl status haproxy
```
