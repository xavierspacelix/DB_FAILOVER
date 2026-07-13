# Instalasi Node C — 10.30.110.116

**Layanan:** etcd (Node 3)  
**Dokumentasi 2026:** [etcd v3.6 config](https://etcd.io/docs/v3.6/op-guide/configuration/)

---

## 1. Prasyarat

- Rocky Linux 9.7
- Akses root
- File `/home/kbbadmin/pgha-offline-bundle-10-Jul-2026.tar.gz` sudah di-copy ke node ini
- File config: `etcd-node-c-10.30.110.116.conf`

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
# Remove conflicting packages dari OS versi lama
rpm -e --nodeps openssl-fips-provider-so 2>/dev/null || true

dnf install --disablerepo='*' --enablerepo=local-offline --allowerasing -y \
  etcd chrony firewalld
```

## 4. Konfigurasi etcd

```bash
cp /home/kbbadmin/etcd-node-c-10.30.110.116.conf /etc/etcd/etcd.conf
```

```ini
ETCD_NAME=etcd3
ETCD_DATA_DIR=/var/lib/etcd/default.etcd
ETCD_LISTEN_PEER_URLS=http://10.30.110.116:2380
ETCD_INITIAL_ADVERTISE_PEER_URLS=http://10.30.110.116:2380
ETCD_LISTEN_CLIENT_URLS=http://10.30.110.116:2379,http://127.0.0.1:2379
ETCD_ADVERTISE_CLIENT_URLS=http://10.30.110.116:2379
ETCD_INITIAL_CLUSTER=etcd1=http://10.30.110.115:2380,etcd2=http://10.30.110.114:2380,etcd3=http://10.30.110.116:2380
ETCD_INITIAL_CLUSTER_STATE=new
ETCD_INITIAL_CLUSTER_TOKEN=pg-etcd-cluster
ETCD_QUOTA_BACKEND_BYTES=8589934592
ETCD_MAX_SNAPSHOTS=5
ETCD_MAX_WALS=5
ETCD_HEARTBEAT_INTERVAL=100
ETCD_ELECTION_TIMEOUT=1000
ETCD_AUTO_COMPACTION_MODE=periodic
ETCD_AUTO_COMPACTION_RETENTION=24h
```

```bash
systemctl enable --now etcd
etcdctl member list
etcdctl endpoint health --cluster
```

## 5. Firewall

```bash
firewall-cmd --permanent --add-port=2379/tcp
firewall-cmd --permanent --add-port=2380/tcp
firewall-cmd --reload
```

## 6. Verifikasi

```bash
etcdctl endpoint health --cluster
systemctl status etcd --no-pager
```
