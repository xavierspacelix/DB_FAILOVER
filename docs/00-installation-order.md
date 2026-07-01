# Urutan Instalasi Cluster PG-HA

> Baca ini dulu sebelum menjalankan instruksi per node.
> Dokumentasi 2026: [etcd v3.6](https://etcd.io/docs/v3.6/) • [Patroni 4.1](https://patroni.readthedocs.io/en/latest/) • [HAProxy 3.4](http://docs.haproxy.org/3.4/) • [Keepalived 2.4](https://www.keepalived.org/documentation/)

---

## Urutan Install

| Urutan | Node | IP | Layanan | Config File |
|--------|------|----|---------|-------------|
| 1 | A, B, C | .12, .13, .14 | etcd cluster (bersamaan) | `configs/etcd-node-*.conf` |
| 2 | D | .10 | Patroni + PostgreSQL (Leader) | `configs/patroni-node-d.yml` |
| 3 | E | .11 | Patroni + PostgreSQL (Replica) | `configs/patroni-node-e.yml` |
| 4 | A | .12 | HAProxy + Keepalived MASTER | `configs/haproxy.cfg`, `configs/keepalived-master.conf` |
| 5 | B | .13 | HAProxy + Keepalived BACKUP | `configs/haproxy.cfg`, `configs/keepalived-backup.conf` |
| 6 | - | .15 | Verifikasi end-to-end via VIP | - |
| - | - | - | **User management** | `docs/06-user-management.md` |
| - | - | - | **Testing** | `docs/98-testing-scenarios.md` |
| - | - | - | **Clean install** | `docs/99-clean-install-all-nodes.md` |

## Catatan Penting

1. **Node A, B, C (etcd):** Start secara bersamaan. Pastikan quorum tercapai sebelum lanjut.
2. **Node D:** Start Patroni duluan agar jadi Leader.
3. **Node E:** Start setelah Node D. Patroni auto-join sebagai Replica via streaming replication.
4. **Node A & B:** Konfigurasi HAProxy + Keepalided paling akhir, setelah replikasi berjalan.
5. **Bundle:** `pgha-offline-bundle.tar.gz` harus sudah tersedia di setiap node.
6. **Config files:** Semua file config ada di direktori `configs/`. Copy sesuai node masing-masing.

## Verifikasi Final

```bash
psql -h 10.30.110.112 -p 5432 -U postgres -c "SELECT pg_is_in_recovery();"
# false = terhubung ke Master via VIP
```
