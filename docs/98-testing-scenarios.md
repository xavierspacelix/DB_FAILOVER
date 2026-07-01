# Testing Scenarios — PG-HA Cluster

> Prosedur testing untuk memvalidasi failover, replikasi, dan high availability.
> Dokumentasi 2026: [Patroni 4.1 REST API](https://patroni.readthedocs.io/en/latest/rest_api.html) • [etcd v3.6 ops](https://etcd.io/docs/v3.6/op-guide/)

---

## Topologi

```
VIP 10.30.13.15
  ├── Node A (.12) Keepalived MASTER + HAProxy + etcd2
  ├── Node B (.13) Keepalived BACKUP  + HAProxy + etcd1
  ├── Node C (.14) etcd3
  ├── Node D (.10) Patroni + PostgreSQL (Leader)
  └── Node E (.11) Patroni + PostgreSQL (Replica)
```

---

## 1. Test Replikasi

Verifikasi data tereplikasi dari Leader ke Replica.

```bash
# 1. Buat database & data di Leader (Node D)
psql -h 10.30.13.10 -U postgres -c "CREATE DATABASE testdb;"
psql -h 10.30.13.10 -U postgres -d testdb -c "
  CREATE TABLE users (id serial primary key, name text);
  INSERT INTO users (name) VALUES ('alice'), ('bob');
"

# 2. Cek apakah sudah tereplikasi ke Replica (Node E)
psql -h 10.30.13.11 -U postgres -d testdb -c "SELECT * FROM users;"
# Harus muncul: alice, bob

# 3. Cek via VIP (harus ke Leader)
psql -h 10.30.13.15 -U postgres -d testdb -c "SELECT * FROM users;"
# Sama — routing via HAProxy

# 4. Cek slot replikasi
psql -h 10.30.13.10 -U postgres -c "SELECT * FROM pg_stat_replication;"
```

| Kolom | Harus |
|-------|-------|
| `state` | `streaming` |
| `sync_state` | `async` |
| `sent_lag \| write_lag \| flush_lag \| replay_lag` | mendekati 0 |

---

## 2. Test Failover — Matikan Leader

Skenario: Node D (Leader) dimatikan, Patroni otomatis mempromosikan Node E jadi Leader baru.

```bash
# 1. Cek status awal
patronictl -c /etc/patroni/patroni.yml list

# Output:
# + Cluster: pg_cluster ---+----+-----------+
# | Member  | Host         | Role  | State   |
# +---------+--------------+-------+---------+
# | node-d  | 10.30.13.10  | Leader| running |
# | node-e  | 10.30.13.11  | Replica| running |
# +---------+--------------+-------+---------+

# 2. Matikan Patroni di Node D (Leader)
ssh root@10.30.13.10 "systemctl stop patroni"

# 3. Tunggu 10-30 detik (ttl=30), cek status
patronictl -c /etc/patroni/patroni.yml list

# Output:
# + Cluster: pg_cluster ---+----+-----------+
# | Member  | Host         | Role  | State   |
# +---------+--------------+-------+---------+
# | node-d  | 10.30.13.10  |       | stopped |
# | node-e  | 10.30.13.11  | Leader| running |
# +---------+--------------+-------+---------+

# 4. Verifikasi koneksi via VIP masih jalan (otomatis ke Node E)
psql -h 10.30.13.15 -U postgres -d testdb -c "SELECT * FROM users;"
# Harus tetap bisa query — HAProxy routing ke Leader baru

# 5. Cek Node E benar-benar Leader (tidak dalam recovery)
psql -h 10.30.13.15 -U postgres -c "SELECT pg_is_in_recovery();"
# false = bukan recovery → Leader

# 6. Cek timeline
psql -h 10.30.13.15 -U postgres -c "SELECT timeline_id FROM pg_stat_progress_basebackup;"
# atau
psql -h 10.30.13.15 -U postgres -c "SELECT system_identifier, timeline_id, xlogpos FROM pg_control_checkpoint();"
```

### Recovery — Kembalikan Node D sebagai Replica

```bash
# 1. Start ulang Patroni di Node D
ssh root@10.30.13.10 "systemctl start patroni"

# 2. Tunggu, cek status — Node D otomatis join sebagai Replica
patronictl -c /etc/patroni/patroni.yml list

# Output:
# + Cluster: pg_cluster ---+----+-----------+
# | Member  | Host         | Role  | State   |
# +---------+--------------+-------+---------+
# | node-e  | 10.30.13.11  | Leader| running |
# | node-d  | 10.30.13.10  | Replica| running |
# +---------+--------------+-------+---------+
```

---

## 3. Test Switchover (Manual)

Switchover: memindahkan peran Leader tanpa downtime.

```bash
# 1. Cek status
patronictl -c /etc/patroni/patroni.yml list

# 2. Lakukan switchover — pindah Leader dari Node E ke Node D
patronictl -c /etc/patroni/patroni.yml switchover --master node-e --candidate node-d

# Output prompt:
# Current cluster topology
# + Cluster: pg_cluster ---+----+-----------+
# | Member  | Host         | Role  | State   |
# +---------+--------------+-------+---------+
# | node-e  | 10.30.13.11  | Leader| running |
# | node-d  | 10.30.13.10  | Replica| running |
# +---------+--------------+-------+---------+
# Are you sure you want to switchover? [y/N]: y

# 3. Verifikasi
patronictl -c /etc/patroni/patroni.yml list

# Output:
# + Cluster: pg_cluster ---+----+-----------+
# | Member  | Host         | Role  | State   |
# +---------+--------------+-------+---------+
# | node-d  | 10.30.13.10  | Leader| running |
# | node-e  | 10.30.13.11  | Replica| running |
# +---------+--------------+-------+---------+

# 4. Verifikasi tidak ada downtime
psql -h 10.30.13.15 -U postgres -d testdb -c "SELECT count(*) FROM users;"
# count = 2 (data tetap utuh)

# 5. Cek timeline bertambah
psql -h 10.30.13.15 -U postgres -c "SELECT timeline_id FROM pg_control_checkpoint();"
# Timeline naik 1 setiap switchover/failover
```

---

## 4. Test HAProxy Health Check

```bash
# 1. Cek status backend via HAProxy stats
# Buka di browser: http://10.30.13.12:8080/stats
# atau
curl -u admin:admin123 http://10.30.13.12:8080/stats 2>/dev/null | grep -E "pg_node|status"

# 2. Test health check endpoint Patroni langsung
curl -s http://10.30.13.10:8008/master | python3 -m json.tool
# Harus return {"state": "running", ...}

curl -s http://10.30.13.11:8008/master | python3 -m json.tool
# Harus return 503 (bukan master)

curl -s http://10.30.13.11:8008/replica | python3 -m json.tool
# Harus return {"state": "running", ...}

# 3. Test HAProxy routing — matikan Leader
ssh root@10.30.13.10 "systemctl stop patroni"
sleep 15

# Cek health — HAProxy harus sudah pindah ke Node E
curl -s http://10.30.13.11:8008/master | python3 -m json.tool
# return 200 (karena sekarang Leader)
```

---

## 5. Test etcd Cluster Health

```bash
# 1. Daftar member
etcdctl member list

# Output:
# etcd1[unstarted]: name=etcd1 peerURLs=http://10.30.13.13:2380 clientURLs=http://10.30.13.13:2379 isLeader=false
# etcd2[unstarted]: name=etcd2 peerURLs=http://10.30.13.12:2380 clientURLs=http://10.30.13.12:2379 isLeader=false
# etcd3[unstarted]: name=etcd3 peerURLs=http://10.30.13.14:2380 clientURLs=http://10.30.13.14:2379 isLeader=true

# 2. Health semua endpoint
etcdctl endpoint health --cluster -w table

# Output:
# +-------------------+-----------+-------------+-------+
# |    ENDPOINT       |  HEALTH   |  TOOK       | ERROR |
# +-------------------+-----------+-------------+-------+
# | 10.30.13.12:2379  |   true    | 2.345678ms  |       |
# | 10.30.13.13:2379  |   true    | 3.123456ms  |       |
# | 10.30.13.14:2379  |   true    | 1.987654ms  |       |
# +-------------------+-----------+-------------+-------+

# 3. Status endpoint
etcdctl endpoint status --cluster -w table

# 4. Test tolerance — matikan 1 node etcd
ssh root@10.30.13.14 "systemctl stop etcd"
etcdctl endpoint health --cluster
# 2/3 sehat — quorum masih aman

# 5. Matikan 2 node (simulasi quorum lost)
ssh root@10.30.13.13 "systemctl stop etcd"
etcdctl endpoint health --cluster
# Gagal — quorum hilang, cluster read-only
```

### Recovery dari quorum loss

```bash
# 1. Start node yang mati
ssh root@10.30.13.13 "systemctl start etcd"
ssh root@10.30.13.14 "systemctl start etcd"

# 2. Verifikasi
etcdctl endpoint health --cluster -w table
# Semua harus true

# 3. Cek Patroni — harus recover otomatis
patronictl -c /etc/patroni/patroni.yml list
```

---

## 6. Test Keepalived VIP

```bash
# 1. Cek VIP ada di mana
ip addr show | grep 10.30.13.15

# Harus aktif di Node A (MASTER)

# 2. Matikan keepalived di Node A
ssh root@10.30.13.12 "systemctl stop keepalived"
sleep 3

# 3. Cek VIP pindah ke Node B
ssh root@10.30.13.13 "ip addr show | grep 10.30.13.15"
# VIP harus aktif di Node B

# 4. Verifikasi koneksi via VIP masih jalan
psql -h 10.30.13.15 -U postgres -c "SELECT 1 AS vip_test;"

# 5. Kembalikan Node A
ssh root@10.30.13.12 "systemctl start keepalived"
sleep 3

# 6. VIP kembali ke Node A (priority lebih tinggi)
ip addr show | grep 10.30.13.15
# VIP di Node A lagi
```

---

## 7. Test Downtime — Simulasi Total

Skenario paling ekstrem: matikan semua node lalu hidupkan satu per satu.

```bash
# 1. Matikan semua service di semua node
# Node D (Leader)
ssh root@10.30.13.10 "systemctl stop patroni"
# Node E (Replica)
ssh root@10.30.13.11 "systemctl stop patroni"
# Node A (MASTER + etcd)
ssh root@10.30.13.12 "systemctl stop keepalived haproxy etcd"
# Node B (BACKUP + etcd)
ssh root@10.30.13.13 "systemctl stop keepalived haproxy etcd"
# Node C (etcd)
ssh root@10.30.13.14 "systemctl stop etcd"

# 2. Start etcd dulu (A, B, C)
ssh root@10.30.13.12 "systemctl start etcd"
ssh root@10.30.13.13 "systemctl start etcd"
ssh root@10.30.13.14 "systemctl start etcd"
sleep 5
etcdctl endpoint health --cluster

# 3. Start Patroni Leader (Node D)
ssh root@10.30.13.10 "systemctl start patroni"
sleep 15
patronictl list

# 4. Start Patroni Replica (Node E)
ssh root@10.30.13.11 "systemctl start patroni"
sleep 15

# 5. Start HAProxy + Keepalived (Node A, B)
ssh root@10.30.13.12 "systemctl start haproxy keepalived"
ssh root@10.30.13.13 "systemctl start haproxy keepalived"

# 6. Verifikasi final
patronictl -c /etc/patroni/patroni.yml list
psql -h 10.30.13.15 -U postgres -c "SELECT pg_is_in_recovery();"
psql -h 10.30.13.15 -U postgres -d testdb -c "SELECT count(*) FROM users;"
```

---

## 8. Test Patroni REST API

```bash
# Endpoint per node
NODE_D="http://10.30.13.10:8008"
NODE_E="http://10.30.13.11:8008"

# Cluster overview
curl -s $NODE_D/cluster | python3 -m json.tool

# Health
curl -s $NODE_D/health | python3 -m json.tool

# Config
curl -s $NODE_D/config | python3 -m json.tool

# History (timeline switches)
curl -s $NODE_D/history | python3 -m json.tool

# Leader check
curl -s -o /dev/null -w "%{http_code}" $NODE_D/master
# 200 = Leader, 503 = bukan Leader

# Replica check
curl -s -o /dev/null -w "%{http_code}" $NODE_D/replica
# 200 = Replica, 503 = bukan Replica
```

---

## Ringkasan Skenario

| # | Skenario | Harus | Waktu |
|---|----------|-------|-------|
| 1 | Replikasi data | Data sama di kedua node | ~1 menit |
| 2 | Failover (Leader mati) | Replica jadi Leader | ~30 detik |
| 3 | Switchover manual | Pindah Leader tanpa downtime | ~10 detik |
| 4 | HAProxy health check | Routing ke Leader saja | ~15 detik |
| 5 | etcd quorum | 2/3 node cukup, <2 gagal | ~30 detik |
| 6 | VIP pindah | VIP pindah ke BACKUP | ~5 detik |
| 7 | Total recovery | Semua hidup kembali normal | ~2 menit |
| 8 | REST API | Semua endpoint response | ~10 detik |
