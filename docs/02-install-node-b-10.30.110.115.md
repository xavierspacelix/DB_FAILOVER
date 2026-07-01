# Instalasi Node B — 10.30.110.115

**Layanan:** etcd (Node 1) + HAProxy + Keepalived (BACKUP)  
**Dokumentasi 2026:** [etcd v3.6 config](https://etcd.io/docs/v3.6/op-guide/configuration/) • [HAProxy 3.4](http://docs.haproxy.org/3.4/configuration.html) • [Keepalived 2.4](https://www.keepalived.org/documentation/keepalived-conf/)

---

## 1. Prasyarat

- Rocky Linux 9.7
- Akses root
- File `/home/kbbadmin/pgha-offline-bundle.tar.gz` sudah di-copy ke node ini
- File config: `etcd-node-b-10.30.110.115.conf`, `haproxy.cfg`, `keepalived-backup-10.30.110.115.conf`

## 2. Ekstrak Bundle & Setup Repo Lokal

```bash
tar xzf /home/kbbadmin/pgha-offline-bundle.tar.gz -C /home/kbbadmin/

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
dnf install --disablerepo='*' --enablerepo=local-offline -y \
  etcd haproxy keepalived chrony firewalld
```

## 4. Konfigurasi etcd

```bash
cp /home/kbbadmin/etcd-node-b-10.30.110.115.conf /etc/etcd/etcd.conf
```

```ini
ETCD_NAME=etcd1
ETCD_DATA_DIR=/var/lib/etcd/default.etcd
ETCD_LISTEN_PEER_URLS=http://10.30.110.115:2380
ETCD_INITIAL_ADVERTISE_PEER_URLS=http://10.30.110.115:2380
ETCD_LISTEN_CLIENT_URLS=http://10.30.110.115:2379,http://127.0.0.1:2379
ETCD_ADVERTISE_CLIENT_URLS=http://10.30.110.115:2379
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

## 5. Konfigurasi HAProxy

```bash
cp /home/kbbadmin/haproxy.cfg /etc/haproxy/haproxy.cfg
```

```haproxy
global
    log /dev/log local0
    maxconn 4096
    user haproxy
    group haproxy
    daemon
    stats socket /run/haproxy/admin.sock mode 660 level admin

defaults
    log global
    mode tcp
    option tcplog
    retries 3
    timeout connect 10s
    timeout client 30s
    timeout server 30s

frontend pg_frontend
    bind *:5432
    default_backend pg_backend

backend pg_backend
    option httpchk GET /master
    http-check expect status 200
    server pg-node-d 10.30.110.128:5432 check port 8008 inter 5s fall 3 rise 2
    server pg-node-e 10.30.110.113:5432 check port 8008 inter 5s fall 3 rise 2
```

```bash
systemctl enable --now haproxy
```

## 6. Konfigurasi Keepalived (BACKUP)

```bash
cp /home/kbbadmin/keepalived-backup-10.30.110.115.conf /etc/keepalived/keepalived.conf
```

Keepalived 2.4 — `state BACKUP` priority 100, hanya menjadi aktif jika MASTER down:

```ini
global_defs { router_id PGHA_B }
vrrp_script check_haproxy {
    script "/usr/bin/killall -0 haproxy"
    interval 2; weight 2; fall 2; rise 2
}
vrrp_instance VI_PG {
    state BACKUP
    interface eth0
    virtual_router_id 51
    priority 100
    advert_int 1
    authentication { auth_type PASS; auth_pass pgcluster99 }
    virtual_ipaddress { 10.30.110.112/24 }
    track_script { check_haproxy }
}
```

```bash
systemctl enable --now keepalived
ip addr show | grep 10.30.110.112
```

## 7. Firewall

```bash
firewall-cmd --permanent --add-port=2379/tcp
firewall-cmd --permanent --add-port=2380/tcp
firewall-cmd --permanent --add-port=5432/tcp
firewall-cmd --permanent --add-port=8008/tcp
firewall-cmd --reload
```

## 8. Verifikasi

```bash
etcdctl endpoint health --cluster
systemctl status haproxy keepalived --no-pager
ip addr show | grep 10.30.110.112
```
