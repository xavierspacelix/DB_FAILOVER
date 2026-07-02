# WBS Timeline — PG-HA Cluster Deployment

**Start Date:** 02-Juli-2026  
**Target OS:** RHEL / Rocky Linux 9.x  

---

## Fase 1 — Persiapan (02–04 Juli)

| ID | Task | Durasi | Start | End | Dep |
|----|------|--------|-------|-----|-----|
| 1.1 | Setup builder + aktifkan EPEL & PGDG repo | 0.5 day | 02-Jul | 02-Jul | - |
| 1.2 | Install createrepo_c | 0.5 day | 02-Jul | 02-Jul | - |
| 1.3 | Verifikasi ketersediaan paket | 0.5 day | 02-Jul | 02-Jul | - |
| 1.4 | Download all RPMs (274 packages) | 1 day | 03-Jul | 03-Jul | 1.1–1.3 |
| 1.5 | Build repo lokal (createrepo_c) | 0.5 day | 04-Jul | 04-Jul | 1.4 |
| 1.6 | Package bundle (`pgha-offline-bundle.tar.gz`) | 0.5 day | 04-Jul | 04-Jul | 1.5 |
| 1.7 | Test install offline di builder VM | 0.5 day | 04-Jul | 04-Jul | 1.6 |

**Milestone 1:** ✅ Bundle RPM siap deploy

---

## Fase 2 — Deploy etcd Cluster (05–07 Juli)

| ID | Task | Durasi | Start | End | Dep |
|----|------|--------|-------|-----|-----|
| 2.1 | Transfer bundle ke Node A (.114), B (.115), C (.116) | 0.5 day | 05-Jul | 05-Jul | 1.7 |
| 2.2 | Setup repo lokal di Node A, B, C | 0.5 day | 05-Jul | 05-Jul | 2.1 |
| 2.3 | Install etcd di Node A, B, C | 0.5 day | 06-Jul | 06-Jul | 2.2 |
| 2.4 | Konfigurasi etcd (update conf per node) | 0.5 day | 06-Jul | 06-Jul | 2.3 |
| 2.5 | Start etcd cluster (A+B+C bersamaan) | 0.5 day | 07-Jul | 07-Jul | 2.4 |
| 2.6 | Verifikasi quorum etcd (3/3 sehat) | 0.5 day | 07-Jul | 07-Jul | 2.5 |

**Milestone 2:** ✅ etcd cluster 3 node quorum tercapai

---

## Fase 3 — Deploy Patroni + PostgreSQL (07–09 Juli)

| ID | Task | Durasi | Start | End | Dep |
|----|------|--------|-------|-----|-----|
| 3.1 | Transfer bundle + repo ke Node D (.128) | 0.5 day | 07-Jul | 07-Jul | 2.6 |
| 3.2 | Verifikasi parameter PostgreSQL existing di .128 | 0.5 day | 07-Jul | 07-Jul | - |
| 3.3 | Install patroni + patroni-etcd di Node D | 0.5 day | 08-Jul | 08-Jul | 3.1 |
| 3.4 | Konfigurasi Patroni Node D (existing data) | 0.5 day | 08-Jul | 08-Jul | 3.2–3.3 |
| 3.5 | Stop PostgreSQL lama, start Patroni di Node D | 0.5 day | 08-Jul | 08-Jul | 3.4 |
| 3.6 | Verifikasi Node D sebagai Leader + data aman | 0.5 day | 08-Jul | 08-Jul | 3.5 |
| 3.7 | Transfer bundle + repo ke Node E (.113) | 0.5 day | 09-Jul | 09-Jul | 3.6 |
| 3.8 | Install patroni + patroni-etcd di Node E | 0.5 day | 09-Jul | 09-Jul | 3.7 |
| 3.9 | Konfigurasi Patroni Node E (Replica) | 0.5 day | 09-Jul | 09-Jul | 3.8 |
| 3.10 | Start Patroni di Node E (auto-join sebagai Replica) | 0.5 day | 09-Jul | 09-Jul | 3.9 |
| 3.11 | Verifikasi replikasi streaming (Leader → Replica) | 0.5 day | 09-Jul | 09-Jul | 3.10 |

**Milestone 3:** ✅ Patroni cluster 2 node, replikasi streaming jalan

---

## Fase 4 — Deploy HAProxy + Keepalived (10–11 Juli)

| ID | Task | Durasi | Start | End | Dep |
|----|------|--------|-------|-----|-----|
| 4.1 | Transfer bundle + repo ke Node A (.114) & B (.115) | 0.5 day | 10-Jul | 10-Jul | 3.11 |
| 4.2 | Install haproxy + keepalived di Node A & B | 0.5 day | 10-Jul | 10-Jul | 4.1 |
| 4.3 | Konfigurasi HAProxy (sama di Node A & B) | 0.5 day | 10-Jul | 10-Jul | 4.2 |
| 4.4 | Start HAProxy di Node A & B | 0.5 day | 10-Jul | 10-Jul | 4.3 |
| 4.5 | Konfigurasi Keepalived MASTER di Node A | 0.5 day | 11-Jul | 11-Jul | 4.4 |
| 4.6 | Konfigurasi Keepalived BACKUP di Node B | 0.5 day | 11-Jul | 11-Jul | 4.4 |
| 4.7 | Start Keepalived di Node A & B | 0.5 day | 11-Jul | 11-Jul | 4.5–4.6 |
| 4.8 | Verifikasi VIP 10.30.110.112 aktif di MASTER | 0.5 day | 11-Jul | 11-Jul | 4.7 |

**Milestone 4:** ✅ HAProxy + Keepalived + VIP berfungsi

---

## Fase 5 — Testing (12–14 Juli)

| ID | Task | Durasi | Start | End | Dep |
|----|------|--------|-------|-----|-----|
| 5.1 | Test koneksi via VIP (`psql -h 10.30.110.112`) | 0.5 day | 12-Jul | 12-Jul | 4.8 |
| 5.2 | Test replikasi data (buat table, cek di Replica) | 0.5 day | 12-Jul | 12-Jul | 5.1 |
| 5.3 | Test failover (mati Node D, Node E jadi Leader) | 0.5 day | 12-Jul | 12-Jul | 5.2 |
| 5.4 | Test switchover (manual pindah Leader) | 0.5 day | 12-Jul | 12-Jul | 5.3 |
| 5.5 | Test HAProxy health check (routing ke /master) | 0.5 day | 13-Jul | 13-Jul | 5.4 |
| 5.6 | Test etcd quorum tolerance (1 node mati) | 0.5 day | 13-Jul | 13-Jul | 5.5 |
| 5.7 | Test VIP movement (matikan MASTER) | 0.5 day | 13-Jul | 13-Jul | 5.5 |
| 5.8 | Test total recovery (semua node mati → hidup) | 1 day | 14-Jul | 14-Jul | 5.6–5.7 |

**Milestone 5:** ✅ Semua skenario testing lulus

---

## Fase 6 — Dokumentasi & Handover (14–15 Juli)

| ID | Task | Durasi | Start | End | Dep |
|----|------|--------|-------|-----|-----|
| 6.1 | Finalisasi dokumentasi konfigurasi | 0.5 day | 14-Jul | 14-Jul | 5.8 |
| 6.2 | Dokumentasi backup strategy | 0.5 day | 14-Jul | 14-Jul | 5.8 |
| 6.3 | Handover ke tim operasional | 0.5 day | 15-Jul | 15-Jul | 6.1–6.2 |

**Milestone 6:** ✅ Project selesai

---

## Gantt Chart Ringkasan

```
Juli 2026
Task                | 02 | 03 | 04 | 05 | 06 | 07 | 08 | 09 | 10 | 11 | 12 | 13 | 14 | 15 |
--------------------|----|----|----|----|----|----|----|----|----|----|----|----|----|----|
Fase 1: Persiapan   | ██ | ██ | ██ |    |    |    |    |    |    |    |    |    |    |    |
Fase 2: etcd        |    |    |    | ██ | ██ | ██ |    |    |    |    |    |    |    |    |
Fase 3: Patroni     |    |    |    |    |    | ██ | ██ | ██ |    |    |    |    |    |    |
Fase 4: HA+Keepl    |    |    |    |    |    |    |    |    | ██ | ██ |    |    |    |    |
Fase 5: Testing     |    |    |    |    |    |    |    |    |    |    | ██ | ██ | ██ |    |
Fase 6: Dokumen     |    |    |    |    |    |    |    |    |    |    |    |    | ██ | ██ |
```

## Total Estimasi: 14 Hari (10 hari kerja)
