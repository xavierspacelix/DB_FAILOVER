# Instalasi Node D — 10.30.110.128 (Existing DB)

**Layanan:** Patroni 4.1.3 + PostgreSQL 16.14 (Leader)  
**Dokumentasi 2026:** [Patroni 4.1 YAML config](https://patroni.readthedocs.io/en/latest/yaml_configuration.html) • [Patroni configuration](https://patroni.readthedocs.io/en/latest/patroni_configuration.html)

> **CATATAN PENTING:** Node ini sudah memiliki database existing.
> Patroni akan **mengadopsi** data yang ada — data tidak hilang.
> Patroni hanya akan stop PostgreSQL lalu restart dengan managemen Patroni.

---

## 1. Prasyarat

- Rocky Linux 9.7
- Akses root
- File `/root/pgha-offline-bundle.tar.gz` sudah di-copy
- File config: `patroni-node-d-10.30.110.128.yml`
- etcd cluster 3 node sudah running (Node A, B, C)

## 2. Verifikasi Konfigurasi PostgreSQL Existing

Jalankan ini SEBELUM stop PostgreSQL:

```bash
psql -U postgres -c "SHOW wal_level;"
psql -U postgres -c "SHOW max_wal_senders;"
psql -U postgres -c "SHOW max_replication_slots;"
psql -U postgres -c "SHOW wal_log_hints;"

# Cek data directory
psql -U postgres -c "SHOW data_directory;"

# Cek bin directory
pg_config --bindir
```

### Wajib cocok dengan config Patroni:

| Parameter | Config Patroni | Cek perintah |
|-----------|---------------|-------------|
| `wal_level` | `replica` | `SHOW wal_level;` |
| `max_wal_senders` | >= 10 | `SHOW max_wal_senders;` |
| `max_replication_slots` | >= 10 | `SHOW max_replication_slots;` |
| `wal_log_hints` | `on` | `SHOW wal_log_hints;` |

Jika belum sesuai, set dulu di `postgresql.conf` lalu **restart PostgreSQL** sebelum stop:

```bash
# Contoh jika wal_log_hints=off
psql -U postgres -c "ALTER SYSTEM SET wal_log_hints = on;"
# Restart
systemctl restart postgresql-16
```

### Catat info penting:

```bash
# Data directory (default: /var/lib/pgsql/16/data)
psql -U postgres -tA -c "SHOW data_directory;"

# Binary directory (default: /usr/pgsql-16/bin)
pg_config --bindir
```

Jika berbeda dari default, edit `data_dir` dan `bin_dir` di config Patroni.

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
tar xzf /root/pgha-offline-bundle.tar.gz -C /root/

cat <<EOF > /etc/yum.repos.d/local-offline.repo
[local-offline]
name=Local Offline Repo
baseurl=file:///root/offline-rpms
enabled=1
gpgcheck=0
EOF

dnf clean all
```

## 5. Install Paket

```bash
dnf install --disablerepo='*' --enablerepo=local-offline -y \
  patroni patroni-etcd chrony firewalld
```

> **Tidak perlu install `postgresql16-server`** — PostgreSQL sudah terinstall di node ini.
> Yang diinstall hanya `patroni` + `patroni-etcd`.

## 6. Konfigurasi Patroni

```bash
mkdir -p /etc/patroni
cp /root/patroni-node-d-10.30.110.128.yml /etc/patroni/patroni.yml
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

## 7. Stop PostgreSQL Lama — Start Patroni

```bash
# Stop PostgreSQL yang berjalan manual
systemctl stop postgresql-16

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

## 8. Verifikasi Data Existing

```bash
# Cek database masih utuh
psql -h 127.0.0.1 -U postgres -c "\l"

# Cek table masih ada (ganti nama_db sesuai punya)
psql -h 127.0.0.1 -U postgres -d nama_db -c "\dt"

# Cek user masih ada
psql -h 127.0.0.1 -U postgres -c "\du"
```

## 9. Firewall

```bash
firewall-cmd --permanent --add-port=5432/tcp
firewall-cmd --permanent --add-port=8008/tcp
firewall-cmd --reload
```

## 10. Final Check

```bash
patronictl -c /etc/patroni/patroni.yml list
# node-d sebagai Leader, data existing aman
```
