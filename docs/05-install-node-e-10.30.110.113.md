# Instalasi Node E — 10.30.110.113

**Layanan:** Patroni 4.1.3 + PostgreSQL 16.14 (Replica)  
**Dokumentasi 2026:** [Patroni 4.1 YAML config](https://patroni.readthedocs.io/en/latest/yaml_configuration.html) • [Patroni configuration](https://patroni.readthedocs.io/en/latest/patroni_configuration.html)

---

## 1. Prasyarat

- Rocky Linux 9.7
- Akses root
- File `/home/kbbadmin/pgha-offline-bundle-10-Jul-2026.tar.gz` sudah di-copy
- File config: `patroni-node-e-10.30.110.113.yml`
- etcd cluster 3 node sudah running
- Node D (Leader) sudah running

## 2. Ekstrak Bundle & Setup Repo Lokal

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

## 3. Install Paket

```bash
dnf install --disablerepo='*' --enablerepo=local-offline --allowerasing -y \
  postgresql16-server postgresql16-contrib patroni patroni-etcd \
  chrony firewalld
```

## 4. Konfigurasi Patroni

```bash
mkdir -p /etc/patroni /var/lib/pgsql/16/data
chown postgres:postgres /var/lib/pgsql/16/data
cp /home/kbbadmin/patroni-node-e-10.30.110.113.yml /etc/patroni/patroni.yml
```

Bedanya dengan Node D hanya di `name: node-e` dan IP bind:

```yaml
scope: pg_cluster
namespace: /db/
name: node-e

restapi:
    listen: 10.30.110.113:8008
    connect_address: 10.30.110.113:8008

etcd3:
    hosts:
        - 10.30.110.114:2379
        - 10.30.110.115:2379
        - 10.30.110.116:2379

bootstrap:
    users:
        groupware:
            password: 'KBBgroupware@2025!'

    pg_hba:
        - host replication replicator 10.30.110.0/24 md5
        - host all groupware 10.30.110.0/24 md5
        - host all postgres 127.0.0.1/32 trust

postgresql:
    listen: 10.30.110.113:5432
    connect_address: 10.30.110.113:5432
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
```

## 5. Start Patroni sebagai Replica

Patroni otomatis mendeteksi cluster via etcd, melakukan `pg_basebackup` dari Leader, dan join sebagai Replica:

```bash
systemctl enable --now patroni
```

Tunggu 15-30 detik (proses clone dari Leader):

```bash
patronictl -c /etc/patroni/patroni.yml list
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

# Cek status recovery
psql -h 127.0.0.1 -U postgres -c "SELECT pg_is_in_recovery();"
# t = true (Replica - dalam recovery mode)

# Verifikasi replikasi dari Leader
psql -h 10.30.110.128 -U postgres -c "SELECT * FROM pg_stat_replication;"
```
