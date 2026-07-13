# Backup Strategy — PG-HA Cluster

> Prosedur backup & restore untuk cluster PostgreSQL dengan Patroni + etcd.

---

## 1. Backup PostgreSQL — pgBackRest

### Install

```bash
# Remove conflicting packages dari OS versi lama
rpm -e --nodeps openssl-fips-provider-so 2>/dev/null || true

dnf install --disablerepo='*' --enablerepo=local-offline --allowerasing -y pgbackrest
```

### Konfigurasi

Buat `/etc/pgbackrest/pgbackrest.conf`:

```ini
[pg_cluster]
pg1-path=/var/lib/pgsql/16/data
pg1-port=5432
repo1-path=/backup/pgbackrest
repo1-retention-full=4
repo1-retention-diff=4
repo1-cipher-type=none

[global]
log-level-console=info
log-level-file=detail
compress-type=gz
process-max=2
```

### Integrasi dengan Patroni

Tambah parameter di Patroni config (`/etc/patroni/patroni.yml`):

```yaml
postgresql:
    parameters:
        archive_mode: on
        archive_command: 'pgbackrest --stanza=pg_cluster archive-push %p'
        archive_timeout: 60
```

Reload Patroni:

```bash
patronictl -c /etc/patroni/patroni.yml reload node-d
```

Buat stanza:

```bash
pgbackrest --stanza=pg_cluster stanza-create
```

### Jadwal Backup

| Type | Frekuensi | Waktu | Perintah |
|------|-----------|-------|----------|
| Full | Minggu | Minggu 02:00 | `pgbackrest --stanza=pg_cluster --type=full backup` |
| Diff | Hari | Setiap 22:00 | `pgbackrest --stanza=pg_cluster --type=diff backup` |

### Cron

```bash
# Full backup setiap Minggu jam 2 pagi
0 2 * * 0 /usr/bin/pgbackrest --stanza=pg_cluster --type=full backup

# Diff backup setiap hari jam 10 malam
0 22 * * * /usr/bin/pgbackrest --stanza=pg_cluster --type=diff backup
```

### Restore

```bash
# Cek backup tersedia
pgbackrest --stanza=pg_cluster info

# Restore penuh
systemctl stop patroni
pgbackrest --stanza=pg_cluster restore
systemctl start patroni

# Restore ke timeline tertentu
pgbackrest --stanza=pg_cluster --set=20260701-020000F restore
```

---

## 2. Backup etcd

### Snapshot

```bash
# Backup harian
etcdctl snapshot save /backup/etcd/snapshot-$(date +%Y%m%d).db

# Verifikasi
etcdctl snapshot status /backup/etcd/snapshot-20260701.db -w table
```

### Cron

```bash
# Backup setiap jam 3 pagi
0 3 * * * /usr/bin/etcdctl snapshot save /backup/etcd/snapshot-$(date +%%Y%%m%%d).db
```

### Restore etcd

```bash
# Hanya bisa restore ke cluster BARU (tidak bisa in-place)
etcdctl snapshot restore /backup/etcd/snapshot-20260701.db \
  --name etcd1 \
  --initial-cluster etcd1=http://10.30.110.115:2380,etcd2=http://10.30.110.114:2380,etcd3=http://10.30.110.116:2380 \
  --initial-cluster-token pg-etcd-cluster \
  --data-dir /var/lib/etcd/restored
```

---

## 3. Backup Patroni Config

```bash
# Dump konfigurasi dinamis dari DCS
patronictl -c /etc/patroni/patroni.yml show-config > /backup/patroni-config-$(date +%Y%m%d).yml
```

---

## 4. Retention Policy

| Backup | Retention | Tujuan |
|--------|-----------|--------|
| Full PostgreSQL | 4 minggu | Point-in-time recovery |
| Diff PostgreSQL | 4 hari | Recovery cepat harian |
| WAL archive | Sampai full berikutnya | PITR ke detik |
| etcd snapshot | 7 hari | Recovery cluster etcd |
| Patroni config | 30 hari | Audit & rollback |

---

## 5. Disaster Recovery Flow

```
Step 1: Restore etcd snapshot → cluster baru
Step 2: Cek Patroni config
Step 3: Restore PostgreSQL via pgBackRest
Step 4: Start Patroni → join cluster
Step 5: Verify replication
```
