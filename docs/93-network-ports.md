# Network Port Requirements — PG-HA Cluster

## Topologi

| Node | IP | Layanan |
|------|----|---------|
| Node A (tgdbha01) | 10.30.110.114 | etcd, HAProxy, Keepalived MASTER |
| Node B (tgdbha02) | 10.30.110.115 | etcd, HAProxy, Keepalived BACKUP |
| Node C (tgdbha03) | 10.30.110.116 | etcd |
| Node D (tpgdb01) | 10.30.110.128 | Patroni + PostgreSQL (Leader) |
| Node E (tgpgdb02) | 10.30.110.113 | Patroni + PostgreSQL (Replica) |
| VIP | 10.30.110.112 | HAProxy (floating IP) |
| Aplikasi | 10.0.x.x | Client / Application Server |

## Port Matrix

| Dari | Ke | Port | Protocol | Service | Wajib? |
|------|----|------|----------|---------|--------|
| 10.30.110.114, .115, .116 | 10.30.110.114, .115, .116 | 2379 | TCP | etcd peer | ✅ |
| 10.30.110.114, .115, .116 | 10.30.110.114, .115, .116 | 2380 | TCP | etcd client | ✅ |
| 10.30.110.128, .113 | 10.30.110.114, .115, .116 | 2379 | TCP | Patroni → etcd | ✅ |
| 10.30.110.114, .115 | 10.30.110.128, .113 | 5432 | TCP | PostgreSQL (HAProxy health check + koneksi) | ✅ |
| 10.30.110.114, .115 | 10.30.110.128, .113 | **8008** | TCP | Patroni REST API /master | ✅ **HAProxy health check** |
| 10.30.110.128 | 10.30.110.113 | 5432 | TCP | Streaming replication | ✅ |
| 10.30.110.113 | 10.30.110.128 | 5432 | TCP | Streaming replication | ✅ |
| 10.0.x.x (Aplikasi) | 10.30.110.112 (VIP) | 5432 | TCP | Koneksi aplikasi ke DB | ✅ |
| Admin | 10.30.110.114, .115 | 8080 | TCP | HAProxy Stats UI | Optional |

## Catatan untuk Tim Jaringan

### HAProxy Health Check
HAProxy di 10.30.110.114 dan 10.30.110.115 perlu **akses TCP port 8008** ke 10.30.110.128 dan 10.30.110.113 untuk mengecek endpoint `/master` Patroni. Tanpa akses ini, HAProxy akan menganggap semua backend DOWN dan koneksi database via VIP gagal.

### Firewall Rule (Contoh)
```bash
# Di 10.30.110.128 & 10.30.110.113
firewall-cmd --permanent --add-source=10.30.110.114/32 --add-port=8008/tcp
firewall-cmd --permanent --add-source=10.30.110.115/32 --add-port=8008/tcp
firewall-cmd --reload

# Atau via subnet
firewall-cmd --permanent --add-source=10.30.110.0/24 --add-port=8008/tcp
firewall-cmd --reload
```

### SELinux
Jika SELinux enforcing, pastikan policy mengizinkan koneksi inbound port 5432 dan 8008:

```bash
semanage port -a -t postgresql_port_t -p tcp 5432
semanage port -a -t http_port_t -p tcp 8008
```

### Routing
10.30.110.114 membawa VIP 10.30.110.112 sebagai secondary IP. Pastikan tidak ada asymmetric routing yang memblok koneksi keluar dari 10.30.110.114 ke subnet 10.30.110.0/24.
