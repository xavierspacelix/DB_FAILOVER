# PG-HA Cluster — PostgreSQL High Availability

Deploy **PostgreSQL 16.14** HA Cluster dengan **Patroni 4.1.3** + **etcd 3.6** + **HAProxy 3.4** + **Keepalived 2.4** di **Rocky Linux 9.7** (air-gapped).

## Arsitektur

```
                    VIP 10.30.13.15
                    │
          ┌─────────┼─────────┐
          │         │         │
    ┌─────▼──┐ ┌────▼───┐ ┌──▼──────┐
    │ Node A │ │ Node B │ │ Node C  │
    │ .12    │ │ .13    │ │ .14     │
    │ etcd2  │ │ etcd1  │ │ etcd3   │
    │ HAProxy│ │ HAProxy│ │         │
    │ MASTER │ │ BACKUP │ │         │
    └────┬───┘ └────┬───┘ └────┬────┘
         │          │          │
         └──────────┼──────────┘
                    │
          ┌─────────┼─────────┐
          │                   │
    ┌─────▼────┐     ┌───────▼──┐
    │ Node D   │     │ Node E   │
    │ .10      │     │ .11      │
    │ Patroni  │     │ Patroni  │
    │ Leader ──┼─────┤ Replica  │
    │ PG Master│     │ PG Slave │
    └──────────┘     └──────────┘
```

## Isi Repository

| Path | Isi |
|------|-----|
| `configs/` | File konfigurasi siap pakai per node |
| `docs/` | Panduan instalasi + testing + clean install |
| `pgha-offline-bundle.tar.gz` | Bundle RPM 274 packages (offline repo) |

### Config Files

| File | Untuk |
|------|-------|
| `configs/etcd-node-a-10.30.13.12.conf` | etcd Node A |
| `configs/etcd-node-b-10.30.13.13.conf` | etcd Node B |
| `configs/etcd-node-c-10.30.13.14.conf` | etcd Node C |
| `configs/patroni-node-d-10.30.13.10.yml` | Patroni + PostgreSQL Node D (Leader) |
| `configs/patroni-node-e-10.30.13.11.yml` | Patroni + PostgreSQL Node E (Replica) |
| `configs/haproxy.cfg` | HAProxy (Node A & B) |
| `configs/keepalived-master-10.30.13.12.conf` | Keepalived MASTER Node A |
| `configs/keepalived-backup-10.30.13.13.conf` | Keepalived BACKUP Node B |

### Documentation

| Doc | Isi |
|-----|-----|
| `docs/00-installation-order.md` | Urutan instalasi |
| `docs/01-install-node-a-10.30.13.12.md` | Instalasi Node A |
| `docs/02-install-node-b-10.30.13.13.md` | Instalasi Node B |
| `docs/03-install-node-c-10.30.13.14.md` | Instalasi Node C |
| `docs/04-install-node-d-10.30.13.10.md` | Instalasi Node D (Leader) |
| `docs/05-install-node-e-10.30.13.11.md` | Instalasi Node E (Replica) |
| `docs/06-user-management.md` | User & koneksi database |
| `docs/98-testing-scenarios.md` | Skenario testing |
| `docs/99-clean-install-all-nodes.md` | Reset & clean install |

## Spesifikasi Node

| Node | IP | Layanan |
|------|----|---------|
| VIP | `10.30.13.15` | Virtual IP (dikelola Keepalived) |
| A | `10.30.13.12` | etcd(2) + HAProxy + Keepalived MASTER |
| B | `10.30.13.13` | etcd(1) + HAProxy + Keepalived BACKUP |
| C | `10.30.13.14` | etcd(3) |
| D | `10.30.13.10` | Patroni + PostgreSQL Leader |
| E | `10.30.13.11` | Patroni + PostgreSQL Replica |

## Versi Software

| Komponen | Versi |
|----------|-------|
| OS | Rocky Linux 9.7 (x86_64) |
| PostgreSQL | 16.14 |
| Patroni | 4.1.3 |
| etcd | 3.6.11 |
| HAProxy | 3.4.1 |
| Keepalived | 2.4.1 |

## DB_URL

```
postgresql://groupware:KBBgroupware@2025!@10.30.13.15:5432/nama_database
```
