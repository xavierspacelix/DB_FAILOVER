# Instalasi Node D — 10.30.110.128 (Existing DB)

**Layanan:** Patroni 4.1.3 + PostgreSQL 16.14 (Leader)  
**Dokumentasi 2026:** [Patroni 4.1 YAML config](https://patroni.readthedocs.io/en/latest/yaml_configuration.html) • [Patroni configuration](https://patroni.readthedocs.io/en/latest/patroni_configuration.html) • [pg_upgrade 16](https://www.postgresql.org/docs/16/pgupgrade.html)

> **CATATAN PENTING:** Node ini memiliki database existing **PostgreSQL 15.6**.
> Proses: PG 15 → pg_upgrade ke PG 16 → Patroni adopt data PG 16.
> Data TIDAK hilang selama upgrade.

---

## 1. Prasyarat

- Rocky Linux 9.7
- Akses root
- File `/home/kbbadmin/pgha-offline-bundle-10-Jul-2026.tar.gz` sudah di-copy
- File config: `patroni-node-d-10.30.110.128.yml`
- etcd cluster 3 node sudah running (Node A, B, C)

## 2. Verifikasi Konfigurasi PostgreSQL Existing (PG 15)

Jalankan ini SEBELUM stop PostgreSQL:

```bash
psql -U postgres -c "SHOW wal_level;"
psql -U postgres -c "SHOW max_wal_senders;"
psql -U postgres -c "SHOW max_replication_slots;"
psql -U postgres -c "SHOW wal_log_hints;"

# Cek data directory
psql -U postgres -c "SHOW data_directory;"

# Cek bin directory PG 15
/usr/pgsql-15/bin/pg_config --bindir
```

### Wajib cocok dengan config Patroni (set sebelum upgrade):

| Parameter | Config Patroni | Cek perintah |
|-----------|---------------|-------------|
| `wal_level` | `replica` | `SHOW wal_level;` |
| `max_wal_senders` | >= 10 | `SHOW max_wal_senders;` |
| `max_replication_slots` | >= 10 | `SHOW max_replication_slots;` |
| `wal_log_hints` | `on` | `SHOW wal_log_hints;` |

Jika belum sesuai, set dulu di `postgresql.conf` lalu restart PG 15:

```bash
psql -U postgres -c "ALTER SYSTEM SET wal_log_hints = on;"
systemctl restart postgresql-15
```

### Catat info penting untuk pg_upgrade:

```bash
# Data directory PG 15 (default: /var/lib/pgsql/15/data)
psql -U postgres -tA -c "SHOW data_directory;"

# Binary directory PG 15 (default: /usr/pgsql-15/bin)
/usr/pgsql-15/bin/pg_config --bindir
```

## 3. Cek User di DB Existing

```bash
psql -U postgres -c "\du"
```

Pastikan user `replicator` dan `rewind_user` belum ada — nanti dibuat Patroni.
User `groupware` harus sudah ada — jika belum, buat:

```bash
psql -U postgres -c "CREATE USER groupware WITH PASSWORD 'KBBgroupware@2025!' CREATEDB CREATEROLE;"
```

## 4. Ekstrak Bundle & Setup Repo Lokal

```bash
tar xzf /home/kbbadmin/pgha-offline-bundle-10-Jul-2026.tar.gz -C /home/kbbadmin/

cat <<EOF > /etc/yum.repos.d/local-offline.repo
[local-offline]
name=Local Offline Repo
baseurl=file:///home/kbbadmin/offline-rpms
enabled=1
gpgcheck=0
EOF

dnf clean all
```

## 5. Install Paket (PG 16 + Patroni)

> **PG 15 sudah terinstall. Sekarang install PG 16 dan Patroni.**

```bash
dnf install --disablerepo='*' --enablerepo=local-offline --allowerasing --setopt=tsflags=replacefiles -y \
  patroni patroni-etcd postgresql16-server chrony firewalld
```

## 6. pg_upgrade PG 15 → PG 16

```bash
# Stop PG 15
systemctl stop postgresql-15

# Pastikan benar-benar stop
ps aux | grep postgres

# Init PG 16 data directory (kosong)
/usr/pgsql-16/bin/initdb -D /var/lib/pgsql/16/data

# Upgrade
/usr/pgsql-16/bin/pg_upgrade \
  --old-bindir=/usr/pgsql-15/bin \
  --new-bindir=/usr/pgsql-16/bin \
  --old-datadir=/var/lib/pgsql/15/data \
  --new-datadir=/var/lib/pgsql/16/data
```

Jika data path berbeda dengan default, sesuaikan `--old-datadir` dan `--new-datadir`.

### Jika pg_upgrade sukses:

```bash
# Cek versi setelah upgrade
/usr/pgsql-16/bin/postgres --version

# Cek data
/usr/pgsql-16/bin/psql -p 5432 -U postgres -c "\l"
```

> **Catatan:** Jika ada error terkait extensions, install package tambahan (`postgresql16-contrib`) lalu ulangi pg_upgrade.
> Patroni akan ambil alih management PG 16 setelah ini.

## 7. Konfigurasi Patroni

```bash
mkdir -p /etc/patroni
cp /home/kbbadmin/patroni-node-d-10.30.110.128.yml /etc/patroni/patroni.yml
```

Tidak perlu buat `data_dir` — sudah ada.  
**Jangan hapus atau pindahkan data directory.**

### Config yang digunakan:

```yaml
scope: pg_cluster
namespace: /db/
name: node-d

restapi:
    listen: 10.30.110.128:8008
    connect_address: 10.30.110.128:8008

etcd3:
    hosts:
        - 10.30.110.114:2379
        - 10.30.110.115:2379
        - 10.30.110.116:2379

bootstrap:
    dcs:
        ttl: 30
        loop_wait: 10
        retry_timeout: 10
        maximum_lag_on_failover: 1048576
        postgresql:
            use_pg_rewind: true
            parameters:
                max_connections: 200
                wal_level: replica
                hot_standby: "on"
                max_wal_senders: 10
                max_replication_slots: 10
                wal_log_hints: "on"
                shared_buffers: 256MB

    # initdb & users TIDAK dipakai — data sudah ada
    pg_hba:
        - host replication replicator 10.30.110.0/24 md5
        - host all groupware 10.30.110.0/24 md5
        - host all postgres 127.0.0.1/32 trust

postgresql:
    listen: 10.30.110.128:5432
    connect_address: 10.30.110.128:5432
    data_dir: /var/lib/pgsql/16/data    # ← pastikan path sesuai existing
    bin_dir: /usr/pgsql-16/bin           # ← pastikan path sesuai existing
    pgpass: /tmp/pgpass
    authentication:
        replication:
            username: replicator
            password: replicator_pass
        superuser:
            username: postgres
            password: postgres_pass
        rewind:
            username: rewind_user
            password: rewind_pass
```

## 8. Stop PostgreSQL Lama — Start Patroni

```bash
# Stop PG 16 yang dijalankan pg_upgrade (jika masih running)
/usr/pgsql-16/bin/pg_ctl -D /var/lib/pgsql/16/data stop

# Pastikan benar-benar stop
ps aux | grep postgres

# Start Patroni — dia akan manage PostgreSQL
systemctl enable --now patroni
```

Tunggu 10-15 detik:

```bash
patronictl -c /etc/patroni/patroni.yml list

psql -h 127.0.0.1 -U postgres -c "SELECT pg_is_in_recovery();"
# Output: f (false = Leader — data existing aman)
```

## 9. Verifikasi Data Existing

```bash
# Cek database masih utuh
psql -h 127.0.0.1 -U postgres -c "\l"

# Cek table masih ada (ganti nama_db sesuai punya)
psql -h 127.0.0.1 -U postgres -d nama_db -c "\dt"

# Cek user masih ada
psql -h 127.0.0.1 -U postgres -c "\du"
```

## 10. Firewall

```bash
firewall-cmd --permanent --add-port=5432/tcp
firewall-cmd --permanent --add-port=8008/tcp
firewall-cmd --reload
```

## 11. Final Check

```bash
patronictl -c /etc/patroni/patroni.yml list
# node-d sebagai Leader, data existing aman
```
