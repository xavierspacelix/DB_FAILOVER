# Dokumentasi Lengkap — PG-HA Cluster

**PostgreSQL 16.14 | Patroni 4.1.3 | etcd 3.6.11 | HAProxy 2.8.14 | Keepalived 2.2.8**  
**Rocky Linux 9.x (Air-gapped)**  
**PIC:** Juan Akbar

---

## Daftar Isi

1. [Topologi & Credentials](#1-topologi--credentials)
2. [Prasyarat](#2-prasyarat)
3. [Setup Bundle Offline](#3-setup-bundle-offline)
4. [Deploy etcd (Node A, B, C)](#4-deploy-etcd-node-a-b-c)
5. [Deploy Patroni — Node D (Existing DB)](#5-deploy-patroni--node-d-existing-db)
6. [Deploy Patroni — Node E (Replica)](#6-deploy-patroni--node-e-replica)
7. [Deploy HAProxy + Keepalived (Node A & B)](#7-deploy-haproxy--keepalived-node-a--b)
8. [User Management](#8-user-management)
9. [Network Ports](#9-network-ports)
10. [Firewall Rules](#10-firewall-rules)
11. [Backup Strategy](#11-backup-strategy)
12. [Handover Checklist](#12-handover-checklist)
13. [Clean Install / Reset](#13-clean-install--reset)
14. [Troubleshooting](#14-troubleshooting)

---

## 1. Topologi & Credentials

### Node Map

| Node | IP | Hostname | Layanan |
|------|----|----------|---------|
| A | 10.30.110.114 | tgdbha01 | etcd, HAProxy, Keepalived MASTER |
| B | 10.30.110.115 | tgdbha02 | etcd, HAProxy, Keepalived BACKUP |
| C | 10.30.110.116 | tgdbha03 | etcd |
| D | 10.30.110.128 | tpgdb01 | Patroni + PostgreSQL (Leader) |
| E | 10.30.110.113 | tgpgdb02 | Patroni + PostgreSQL (Replica) |
| VIP | 10.30.110.112 | - | Floating IP (Keepalived) |

### Credentials

| User | Password | Kegunaan |
|------|----------|----------|
| `groupware` | `KBBgroupware@2025!` | Koneksi aplikasi via VIP |
| `postgres` | `postgres_pass` | Superuser (localhost only) |
| `replicator` | `replicator_pass` | Streaming replication |
| `rewind_user` | `rewind_pass` | pg_rewind (failover) |

### DB URL

```
postgresql://groupware:KBBgroupware@2025!@10.30.110.112:5432/nama_database
```

---

## 2. Prasyarat

- Rocky Linux 9.x (minimal 9.3)
- Akses root di semua node
- Koneksi jaringan antar node (subnet 10.30.110.0/24 dan 10.0.0.0/8)
- SELinux: enforcing atau permissive
- Firewall: managed (port akan dibuka sesuai kebutuhan)
- Server aplikasi (10.0.x.x) bisa akses VIP 10.30.110.112:5432

### Persiapan File

Copy file berikut ke `/home/kbbadmin/` di setiap node:

- `pgha-offline-bundle-10-Jul-2026.tar.gz` (134 MB, 275 RPM)
- Config file per node:
  - Node A: `etcd-node-a-10.30.110.114.conf`, `haproxy.cfg`, `haproxy-tmpfiles.conf`, `keepalived-master-10.30.110.114.conf`
  - Node B: `etcd-node-b-10.30.110.115.conf`, `haproxy.cfg`, `haproxy-tmpfiles.conf`, `keepalived-backup-10.30.110.115.conf`
  - Node C: `etcd-node-c-10.30.110.116.conf`
  - Node D: `patroni-node-d-10.30.110.128.yml`
  - Node E: `patroni-node-e-10.30.110.113.yml`

---

## 3. Setup Bundle Offline

Jalankan di **semua node**:

```bash
# Extract bundle
tar xzf /home/kbbadmin/pgha-offline-bundle-10-Jul-2026.tar.gz -C /home/kbbadmin/

# Setup repo
cat <<EOF > /etc/yum.repos.d/local-offline.repo
[local-offline]
name=Local Offline Repo
baseurl=file:///home/kbbadmin/offline-rpms
enabled=1
gpgcheck=0
EOF

dnf clean all
```

---

## 4. Deploy etcd (Node A, B, C)

Jalankan di **Node A, B, C** (simultan — dalam waktu bersamaan).

```bash
# Install etcd
rpm -e --nodeps openssl-fips-provider-so 2>/dev/null || true
dnf install --disablerepo='*' --enablerepo=local-offline --allowerasing -y \
  etcd chrony firewalld

# Copy config (ganti sesuai node)
cp /home/kbbadmin/etcd-node-a-10.30.110.114.conf /etc/etcd/etcd.conf
# Atau: cp /home/kbbadmin/etcd-node-b-10.30.110.115.conf /etc/etcd/etcd.conf
# Atau: cp /home/kbbadmin/etcd-node-c-10.30.110.116.conf /etc/etcd/etcd.conf

# Firewall
firewall-cmd --permanent --add-port=2379/tcp --add-port=2380/tcp
firewall-cmd --reload

# Start etcd
systemctl enable --now etcd

# Verifikasi
etcdctl member list
etcdctl endpoint health --cluster -w table
```

**Verifikasi quorum** (dari node mana saja):

```bash
etcdctl endpoint health --cluster -w table
# Output: semua 3 node sehat
```

---

## 5. Deploy Patroni — Node D (Existing DB)

Node D sudah memiliki database PostgreSQL 15.6 yang akan di-upgrade ke 16.14.

### 5.1 Verifikasi PG 15

```bash
psql -U postgres -c "SHOW wal_level;"
psql -U postgres -c "SHOW max_wal_senders;"
psql -U postgres -c "SHOW max_replication_slots;"
psql -U postgres -c "SHOW wal_log_hints;"
psql -U postgres -tA -c "SHOW data_directory;"
```

Pastikan: `wal_level=replica`, `max_wal_senders>=10`, `max_replication_slots>=10`, `wal_log_hints=on`.

Jika belum sesuai:

```bash
psql -U postgres -c "ALTER SYSTEM SET wal_log_hints = on;"
systemctl restart postgresql-15
```

### 5.2 Cek User

```bash
psql -U postgres -c "\du"
```

Buat jika belum ada:

```bash
psql -U postgres -c "CREATE USER groupware WITH PASSWORD 'KBBgroupware@2025!' CREATEDB CREATEROLE;"
```

### 5.3 Install PG 16 + Patroni

```bash
rpm -e --nodeps openssl-fips-provider-so 2>/dev/null || true
dnf install --disablerepo='*' --enablerepo=local-offline --allowerasing -y \
  patroni patroni-etcd postgresql16-server chrony firewalld
```

### 5.4 pg_upgrade PG 15 → PG 16

```bash
systemctl stop postgresql-15
ps aux | grep postgres

mkdir -p /var/lib/pgsql/16/data
chown postgres:postgres /var/lib/pgsql/16/data

su - postgres -c "/usr/pgsql-16/bin/initdb -D /var/lib/pgsql/16/data"

su - postgres -c "/usr/pgsql-16/bin/pg_upgrade \
  --old-bindir=/usr/pgsql-15/bin \
  --new-bindir=/usr/pgsql-16/bin \
  --old-datadir=/var/lib/pgsql/15/data \
  --new-datadir=/var/lib/pgsql/16/data"
```

Jika sukses, lanjut. Jika ada error terkait extensions, install `postgresql16-contrib` lalu ulangi.

### 5.5 Konfigurasi Patroni

```bash
mkdir -p /etc/patroni
cp /home/kbbadmin/patroni-node-d-10.30.110.128.yml /etc/patroni/patroni.yml
```

**Penting:** Patroni akan mendeteksi data yang sudah ada dan mengadopsinya. Data tidak hilang.

### 5.6 Start Patroni

```bash
systemctl enable --now patroni
patronictl -c /etc/patroni/patroni.yml list
# node-d harus jadi Leader
```

### 5.7 Verifikasi

```bash
psql -U postgres -c "SELECT pg_is_in_recovery();"
# f = Leader

psql -U postgres -c "\l"
# Data existing harus intact

psql -U postgres -c "\du"
# User harus ada
```

### 5.8 Firewall

```bash
firewall-cmd --permanent --add-port=5432/tcp --add-port=8008/tcp
firewall-cmd --add-source=10.30.110.114/32 --add-port=8008/tcp --permanent
firewall-cmd --add-source=10.30.110.115/32 --add-port=8008/tcp --permanent
firewall-cmd --reload
```

### 5.9 pg_hba (akses jaringan luas)

```bash
echo 'host all groupware 0.0.0.0/0 md5' >> /var/lib/pgsql/16/data/pg_hba.conf
systemctl reload patroni
```

---

## 6. Deploy Patroni — Node E (Replica)

### 6.1 Install

```bash
rpm -e --nodeps openssl-fips-provider-so 2>/dev/null || true
dnf install --disablerepo='*' --enablerepo=local-offline --allowerasing -y \
  patroni patroni-etcd postgresql16-server chrony firewalld
```

### 6.2 Konfigurasi Patroni

```bash
mkdir -p /etc/patroni /var/lib/pgsql/16/data
chown postgres:postgres /var/lib/pgsql/16/data
cp /home/kbbadmin/patroni-node-e-10.30.110.113.yml /etc/patroni/patroni.yml
```

### 6.3 Start Patroni

```bash
systemctl enable --now patroni
patronictl -c /etc/patroni/patroni.yml list
# node-e akan clone dari Leader dan jadi Replica
```

### 6.4 Firewall

```bash
firewall-cmd --permanent --add-port=5432/tcp --add-port=8008/tcp
firewall-cmd --add-source=10.30.110.114/32 --add-port=8008/tcp --permanent
firewall-cmd --add-source=10.30.110.115/32 --add-port=8008/tcp --permanent
firewall-cmd --reload
```

---

## 7. Deploy HAProxy + Keepalived (Node A & B)

### 7.1 Install

```bash
rpm -e --nodeps openssl-fips-provider-so 2>/dev/null || true
dnf install --disablerepo='*' --enablerepo=local-offline --allowerasing -y \
  etcd haproxy keepalived chrony firewalld net-snmp-utils
```

### 7.2 Konfigurasi HAProxy

```bash
cp /home/kbbadmin/haproxy.cfg /etc/haproxy/haproxy.cfg
cp /home/kbbadmin/haproxy-tmpfiles.conf /etc/tmpfiles.d/haproxy.conf
systemd-tmpfiles --create /etc/tmpfiles.d/haproxy.conf

systemctl enable --now haproxy
```

**Catatan:** Di `haproxy.cfg`, pastikan `source` IP di backend sesuai dengan IP node:

- Node A: `source 10.30.110.114`
- Node B: `source 10.30.110.115`

### 7.3 Konfigurasi Keepalived

**Node A (MASTER):**

```bash
cp /home/kbbadmin/keepalived-master-10.30.110.114.conf /etc/keepalived/keepalived.conf

# Pastikan interface sesuai
sed -i "s/interface eth0/interface $(ip -o link show | awk -F': ' '!/lo/ && /UP/ {print $2}' | head -1)/" /etc/keepalived/keepalived.conf

systemctl enable --now keepalived
```

**Node B (BACKUP):**

```bash
cp /home/kbbadmin/keepalived-backup-10.30.110.115.conf /etc/keepalived/keepalived.conf

# Pastikan interface sesuai
sed -i "s/interface eth0/interface $(ip -o link show | awk -F': ' '!/lo/ && /UP/ {print $2}' | head -1)/" /etc/keepalived/keepalived.conf

systemctl enable --now keepalived
```

### 7.4 Firewall

```bash
firewall-cmd --permanent --add-port=5432/tcp --add-port=8080/tcp
firewall-cmd --reload
```

### 7.5 Verifikasi

```bash
# Cek VIP
ip addr show | grep 10.30.110.112

# Cek HAProxy stats
curl -u admin:admin123 http://10.30.110.114:8080/stats

# Cek koneksi via VIP
psql -h 10.30.110.112 -U groupware -d kb_groupware -c "SELECT 1;"
```

---

## 8. User Management

### Daftar User

| User | Password | Attributes | Koneksi Dari |
|------|----------|------------|--------------|
| `postgres` | `postgres_pass` | Superuser, Create role, Create DB, Replication, Bypass RLS | localhost only |
| `groupware` | `KBBgroupware@2025!` | Create DB, Create role | Aplikasi via VIP |
| `replicator` | `replicator_pass` | Replication | Node D ↔ E |
| `rewind_user` | `rewind_pass` | Replication | Node D ↔ E |

### DB URL

```
postgresql://groupware:KBBgroupware@2025!@10.30.110.112:5432/nama_database
```

### Manage User

```bash
# Buat user
psql -U postgres -c "CREATE USER nama_user WITH PASSWORD 'pass' CREATEDB;"

# Ganti password
psql -U postgres -c "ALTER USER groupware PASSWORD 'password_baru';"

# Hapus user
psql -U postgres -c "DROP USER nama_user;"

# List user
psql -U postgres -c "\du"
```

---

## 9. Network Ports

| Dari | Ke | Port | Protocol | Service |
|------|----|------|----------|---------|
| 10.30.110.114, .115, .116 | 10.30.110.114, .115, .116 | 2379, 2380 | TCP | etcd cluster |
| 10.30.110.128, .113 | 10.30.110.114, .115, .116 | 2379 | TCP | Patroni → etcd |
| 10.30.110.114, .115 | 10.30.110.128, .113 | 5432, 8008 | TCP | HAProxy health check |
| 10.30.110.128 | 10.30.110.113 | 5432 | TCP | Replication |
| 10.30.110.113 | 10.30.110.128 | 5432 | TCP | Replication |
| 10.0.x.x (Aplikasi) | 10.30.110.112 (VIP) | 5432 | TCP | Koneksi aplikasi |
| Admin | 10.30.110.114, .115 | 8080 | TCP | HAProxy Stats (opsional) |

---

## 10. Firewall Rules

### Di Node D & E

```bash
firewall-cmd --permanent --add-port=5432/tcp
firewall-cmd --permanent --add-port=8008/tcp
firewall-cmd --permanent --add-source=10.30.110.114/32 --add-port=8008/tcp
firewall-cmd --permanent --add-source=10.30.110.115/32 --add-port=8008/tcp
firewall-cmd --reload
```

### Di Node A & B

```bash
firewall-cmd --permanent --add-port=2379/tcp --add-port=2380/tcp
firewall-cmd --permanent --add-port=5432/tcp --add-port=8080/tcp
firewall-cmd --reload
```

---

## 11. Backup Strategy

### pgBackRest (jika tersedia)

```bash
# Install
rpm -e --nodeps openssl-fips-provider-so 2>/dev/null || true
dnf install --disablerepo='*' --enablerepo=local-offline --allowerasing -y pgbackrest

# Full backup
pgbackrest --stanza=pg_cluster --type=full backup

# Backup info
pgbackrest --stanza=pg_cluster info

# Restore
pgbackrest --stanza=pg_cluster restore
```

### etcd Snapshot

```bash
# Backup
etcdctl snapshot save /backup/etcd-snapshot-$(date +%Y%m%d).db

# Restore
etcdctl snapshot restore /backup/etcd-snapshot-YYYYMMDD.db
  --name node-d --data-dir /var/lib/etcd/restored
  --initial-cluster node-d=http://10.30.110.128:2380
  --initial-cluster-token etcd-cluster-1
```

### Cron (disarankan)

```bash
# Backup harian jam 2 pagi
0 2 * * * /usr/pgsql-16/bin/pg_dump -U groupware -h 127.0.0.1 kb_groupware | gzip > /backup/db-$(date +\%Y\%m\%d).sql.gz
```

---

## 12. Handover Checklist

### Konfigurasi

| Item | Lokasi |
|------|--------|
| Bundle RPM | `/home/kbbadmin/pgha-offline-bundle-10-Jul-2026.tar.gz` |
| Offline repo | `/home/kbbadmin/offline-rpms/` |
| etcd config | `/etc/etcd/etcd.conf` |
| Patroni config | `/etc/patroni/patroni.yml` |
| HAProxy config | `/etc/haproxy/haproxy.cfg` (Node A & B) |
| Keepalived config | `/etc/keepalived/keepalived.conf` (Node A & B) |
| PostgreSQL data | `/var/lib/pgsql/16/data` |

### Service Status

```bash
ssh root@10.30.110.114 "systemctl status etcd haproxy keepalived --no-pager"
ssh root@10.30.110.115 "systemctl status etcd haproxy keepalived --no-pager"
ssh root@10.30.110.116 "systemctl status etcd --no-pager"
ssh root@10.30.110.128 "systemctl status patroni --no-pager"
ssh root@10.30.110.113 "systemctl status patroni --no-pager"
```

### Cluster Status

```bash
# Dari node mana saja
patronictl -c /etc/patroni/patroni.yml list
etcdctl endpoint health --cluster -w table
```

### Perintah yang Sering Dipakai

| Perintah | Kegunaan |
|----------|----------|
| `patronictl list` | Lihat status cluster |
| `patronictl failover` | Failover manual |
| `patronictl switchover` | Switchover manual |
| `etcdctl endpoint health` | Cek kesehatan etcd |
| `systemctl reload haproxy` | Reload HAProxy config |
| `systemctl restart patroni` | Restart Patroni |
| `ip addr show \| grep 10.30.110.112` | Cek VIP aktif |

---

## 13. Clean Install / Reset

### Stop & Disable Semua Service

```bash
# Di setiap node
systemctl stop patroni haproxy keepalived etcd 2>/dev/null
systemctl disable patroni haproxy keepalived etcd 2>/dev/null
```

### Hapus Data & Konfigurasi

```bash
# Data PostgreSQL
rm -rf /var/lib/pgsql/16/data

# Log Patroni
rm -f /var/log/patroni/* 2>/dev/null

# Hapus etcd data
rm -rf /var/lib/etcd/member

# Hapus config
rm -f /etc/patroni/patroni.yml
rm -f /etc/haproxy/haproxy.cfg
rm -f /etc/keepalived/keepalived.conf

# Hapus repo
rm -f /etc/yum.repos.d/local-offline.repo

# Hapus bundle
rm -f /home/kbbadmin/pgha-offline-bundle-10-Jul-2026.tar.gz
rm -rf /home/kbbadmin/offline-rpms
```

### Reset etcd DCS

```bash
etcdctl del /db/pg_cluster --prefix
```

### Reinstall dari Awal

Ulangi dari [Setup Bundle Offline](#3-setup-bundle-offline).

---

## 14. Troubleshooting

### HAProxy: backend pg_backend has no server available

HAProxy tidak bisa health check ke Patroni `/master`.

**Cek:**
```bash
curl -s -o /dev/null -w "%{http_code}" http://10.30.110.128:8008/master
```

**Penyebab & solusi:**
- Firewall blocking port 8008 → buka firewall
- Source IP routing issue → tambah `source 10.30.110.114` di backend
- Patroni tidak running → start Patroni

### Keepalived: unknown authentication type 'PASS'

Keepalived 2.2.x tidak mendukung VRRP authentication.

**Solusi:** Hapus block `authentication` dari keepalived.conf.

### Keepalived: interface eth0 doesn't exist

Nama interface di RHEL 9 berbeda (`ens192`, `ens35`, dll).

**Solusi:**
```bash
sed -i "s/interface eth0/interface $(ip -o link show | awk -F': ' '!/lo/ && /UP/ {print $2}' | head -1)/" /etc/keepalived/keepalived.conf
```

### HAProxy: cannot bind UNIX socket /run/haproxy/admin.sock

Directory `/run/haproxy/` belum ada.

**Solusi:**
```bash
cp /home/kbbadmin/haproxy-tmpfiles.conf /etc/tmpfiles.d/haproxy.conf
systemd-tmpfiles --create /etc/tmpfiles.d/haproxy.conf
systemctl restart haproxy
```

### Patroni: node stuck as Replica, no Leader

**Cek:**
```bash
curl -s --connect-timeout 3 http://10.30.110.114:2379/version
```

**Solusi:**
```bash
# Hapus key initialize dari etcd
python3 -c "
import urllib.request, json, base64
url = 'http://10.30.110.114:2379/v3/kv/deleterange'
key = base64.b64encode(b'/db/pg_cluster/initialize').decode()
data = json.dumps({'key': key}).encode()
req = urllib.request.Request(url, data=data, method='POST')
resp = urllib.request.urlopen(req)
print('Deleted:', json.loads(resp.read())['deleted'])
"
rm -f /var/lib/pgsql/16/data/standby.signal
systemctl restart patroni
```

### DNF: package conflicts (openssl, sqlite, etc.)

Bundle dibangun dari Rocky 9.8, target mungkin 9.6 — menyebabkan konflik versi.

**Solusi:** Gunakan `--allowerasing --setopt=tsflags=replacefiles` atau hapus package conflict manual:
```bash
rpm -e --nodeps openssl-fips-provider-so 2>/dev/null || true
```

### Koneksi via VIP gagal (Connection refused)

**Cek bertahap:**
```bash
# 1. VIP aktif?
ip addr show | grep 10.30.110.112

# 2. HAProxy listen?
ss -tlnp | grep 5432

# 3. HAProxy backend UP?
echo "show stats" | socat unix-connect:/run/haproxy/admin.sock stdio | grep pg_backend

# 4. Health check ke Patroni?
curl -s http://10.30.110.128:8008/health
```

### Replication lag

```bash
patronictl -c /etc/patroni/patroni.yml list
# Cek kolom Lag
```

### pg_upgrade gagal

```bash
# Cek log
tail -50 ~/postupgrade.log 2>/dev/null || tail -50 /var/lib/pgsql/16/data/pg_upgrade_internal.log

# Install missing extensions
dnf install postgresql16-contrib

# Re-run pg_upgrade setelah perbaikan
```

---

## Referensi

- [Patroni 4.1 Documentation](https://patroni.readthedocs.io/en/latest/)
- [etcd v3.6 Documentation](https://etcd.io/docs/v3.6/)
- [HAProxy 2.8 Documentation](http://docs.haproxy.org/2.8/)
- [Keepalived 2.2 Documentation](https://www.keepalived.org/documentation/)
- [PostgreSQL 16 Documentation](https://www.postgresql.org/docs/16/)
- [pg_upgrade 16](https://www.postgresql.org/docs/16/pgupgrade.html)
