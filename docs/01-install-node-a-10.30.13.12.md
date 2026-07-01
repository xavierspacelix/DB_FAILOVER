# Instalasi Node A — 10.30.13.12

**Layanan:** etcd (Node 2) + HAProxy + Keepalived (MASTER)  
**Dokumentasi 2026:** [etcd v3.6 config](https://etcd.io/docs/v3.6/op-guide/configuration/) • [HAProxy 3.4](http://docs.haproxy.org/3.4/configuration.html) • [Keepalived 2.4](https://www.keepalived.org/documentation/keepalived-conf/)

---

## 1. Prasyarat

- Rocky Linux 9.7
- Akses root
- File `/root/pgha-offline-bundle.tar.gz` sudah di-copy ke node ini
- File config: `etcd-node-a-10.30.13.12.conf`, `haproxy.cfg`, `keepalived-master-10.30.13.12.conf`

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
  etcd haproxy keepalived chrony firewalld
```

## 4. Konfigurasi etcd

Copy config:

```bash
cp /root/etcd-node-a-10.30.13.12.conf /etc/etcd/etcd.conf
```

Isi konfigurasi — etcd 3.6 menggunakan environment variables:

```ini
ETCD_NAME=etcd2
ETCD_DATA_DIR=/var/lib/etcd/default.etcd
ETCD_LISTEN_PEER_URLS=http://10.30.13.12:2380
ETCD_INITIAL_ADVERTISE_PEER_URLS=http://10.30.13.12:2380
ETCD_LISTEN_CLIENT_URLS=http://10.30.13.12:2379,http://127.0.0.1:2379
ETCD_ADVERTISE_CLIENT_URLS=http://10.30.13.12:2379
ETCD_INITIAL_CLUSTER=etcd1=http://10.30.13.13:2380,etcd2=http://10.30.13.12:2380,etcd3=http://10.30.13.14:2380
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

Enable & start:

```bash
systemctl enable --now etcd
etcdctl member list
etcdctl endpoint health --cluster
```

## 5. Konfigurasi HAProxy

HAProxy 3.4 health check via Patroni REST API (`/master` endpoint):

```bash
cp /root/haproxy.cfg /etc/haproxy/haproxy.cfg
```

Konfigurasi:

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
    server pg-node-d 10.30.13.10:5432 check port 8008 inter 5s fall 3 rise 2
    server pg-node-e 10.30.13.11:5432 check port 8008 inter 5s fall 3 rise 2
```

Start:

```bash
systemctl enable --now haproxy
```

## 6. Konfigurasi Keepalived (MASTER)

Keepalived 2.4 — `state MASTER` dengan priority 150, track script HAProxy:

```bash
cp /root/keepalived-master-10.30.13.12.conf /etc/keepalived/keepalived.conf
```

```ini
global_defs { router_id PGHA_A }
vrrp_script check_haproxy {
    script "/usr/bin/killall -0 haproxy"
    interval 2; weight 2; fall 2; rise 2
}
vrrp_instance VI_PG {
    state MASTER
    interface eth0
    virtual_router_id 51
    priority 150
    advert_int 1
    authentication { auth_type PASS; auth_pass pgcluster99 }
    virtual_ipaddress { 10.30.13.15/24 }
    track_script { check_haproxy }
}
```

Start:

```bash
systemctl enable --now keepalived
ip addr show | grep 10.30.13.15
```

## 7. Firewall — etcd v3.6 port

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
ip addr show | grep 10.30.13.15
```
