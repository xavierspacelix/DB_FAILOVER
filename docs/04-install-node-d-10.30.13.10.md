# Instalasi Node D — 10.30.13.10

**Layanan:** Patroni 4.1.3 + PostgreSQL 16.14 (Leader)  
**Dokumentasi 2026:** [Patroni 4.1 YAML config](https://patroni.readthedocs.io/en/latest/yaml_configuration.html) • [Patroni configuration](https://patroni.readthedocs.io/en/latest/patroni_configuration.html)

---

## 1. Prasyarat

- Rocky Linux 9.7
- Akses root
- File `/root/pgha-offline-bundle.tar.gz` sudah di-copy
- File config: `patroni-node-d-10.30.13.10.yml`
- etcd cluster 3 node sudah running (Node A, B, C)

## 2. Ekstrak Bundle & Setup Repo Lokal

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

## 3. Install Paket

```bash
dnf install --disablerepo='*' --enablerepo=local-offline -y \
  postgresql16-server postgresql16-contrib patroni patroni-etcd \
  chrony firewalld
```

## 4. Konfigurasi Patroni

Patroni 4.1 menggunakan YAML. Config ini menggunakan `etcd3` (v3 API gRPC-gateway):

```bash
mkdir -p /etc/patroni /var/lib/pgsql/16/data
chown postgres:postgres /var/lib/pgsql/16/data
cp /root/patroni-node-d-10.30.13.10.yml /etc/patroni/patroni.yml
```

```yaml
scope: pg_cluster
namespace: /db/
name: node-d

restapi:
    listen: 10.30.13.10:8008
    connect_address: 10.30.13.10:8008

etcd3:
    hosts:
        - 10.30.13.12:2379
        - 10.30.13.13:2379
        - 10.30.13.14:2379

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
    initdb:
        - encoding: UTF8
        - data-checksums
    users:
        groupware:
            password: 'KBBgroupware@2025!'

    pg_hba:
        - host replication replicator 10.30.13.0/24 md5
        - host all groupware 10.30.13.0/24 md5
        - host all postgres 127.0.0.1/32 trust

postgresql:
    listen: 10.30.13.10:5432
    connect_address: 10.30.13.10:5432
    data_dir: /var/lib/pgsql/16/data
    bin_dir: /usr/pgsql-16/bin
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
    parameters:
        unix_socket_directories: /var/run/postgresql
```

## 5. Start Patroni sebagai Leader

```bash
systemctl enable --now patroni
```

Tunggu 10-15 detik, cek:

```bash
patronictl -c /etc/patroni/patroni.yml list

psql -h 127.0.0.1 -U postgres -c "SELECT pg_is_in_recovery();"
# Output: f (false = Leader)
```

## 6. Firewall

```bash
firewall-cmd --permanent --add-port=5432/tcp
firewall-cmd --permanent --add-port=8008/tcp
firewall-cmd --reload
```

## 7. Verifikasi

```bash
patronictl -c /etc/patroni/patroni.yml list
psql -h 127.0.0.1 -U postgres -c "SELECT pg_is_in_recovery();"
# f = Leader, t = Replica
```
