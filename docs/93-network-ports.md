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
| Node A, B, C | Node A, B, C | 2379 | TCP | etcd peer | ✅ |
| Node A, B, C | Node A, B, C | 2380 | TCP | etcd client | ✅ |
| Node D, E | Node A, B, C | 2379 | TCP | Patroni → etcd | ✅ |
| Node A, B | Node D, E | 5432 | TCP | PostgreSQL (HAProxy health check + koneksi) | ✅ |
| Node A, B | Node D, E | **8008** | TCP | Patroni REST API /master | ✅ **HAProxy health check** |
| Node D | Node E | 5432 | TCP | Streaming replication | ✅ |
| Node E | Node D | 5432 | TCP | Streaming replication | ✅ |
| Aplikasi (10.0.x.x) | VIP (10.30.110.112) | 5432 | TCP | Koneksi aplikasi ke DB | ✅ |
| Admin / Monitoring | Node A, B | 8080 | TCP | HAProxy Stats UI | Optional |

## Catatan untuk Tim Jaringan

### HAProxy Health Check
HAProxy di Node A (10.30.110.114) dan Node B (10.30.110.115) perlu **akses TCP port 8008** ke Node D (10.30.110.128) dan Node E (10.30.110.113) untuk mengecek endpoint `/master` Patroni. Tanpa akses ini, HAProxy akan menganggap semua backend DOWN dan koneksi database via VIP gagal.

### Firewall Rule (Contoh)
```bash
# Di Node D & E
firewall-cmd --permanent --add-source=10.30.110.114/32 --add-port=8008/tcp
firewall-cmd --permanent --add-source=10.30.110.115/32 --add-port=8008/tcp
firewall-cmd --reload

# Atau subnet
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
Node A (10.30.110.114) membawa VIP 10.30.110.112 sebagai secondary IP. Pastikan tidak ada asymmetric routing yang memblok koneksi keluar dari Node A ke subnet 10.30.110.0/24.
