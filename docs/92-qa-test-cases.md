# QA Test Cases — PG-HA Cluster

**Project:** PostgreSQL High Availability Cluster  
**Tester:** Juan Akbar  
**Date:** 12–14 July 2026  

---

## TC-01: Koneksi Database via VIP

| Item | Detail |
|------|--------|
| **Test ID** | TC-01 |
| **Title** | Koneksi database via Virtual IP |
| **Precondition** | Cluster running, VIP aktif di Node A |
| **Steps** | 1. `psql -h 10.30.110.112 -p 5432 -U groupware -d postgres -c "SELECT 1 AS test;"` |
| **Expected** | Query sukses, return `1` |
| **Actual** | |
| **Status** | ☐ Pass / ☐ Fail |
| **Notes** | |

---

## TC-02: Koneksi Direct ke Leader

| Item | Detail |
|------|--------|
| **Test ID** | TC-02 |
| **Title** | Koneksi langsung ke Node D (Leader) |
| **Precondition** | Node D sebagai Leader |
| **Steps** | 1. `psql -h 10.30.110.128 -U groupware -c "SELECT pg_is_in_recovery();"` |
| **Expected** | Return `f` (false = not in recovery) |
| **Actual** | |
| **Status** | ☐ Pass / ☐ Fail |
| **Notes** | |

---

## TC-03: Koneksi Direct ke Replica

| Item | Detail |
|------|--------|
| **Test ID** | TC-03 |
| **Title** | Koneksi langsung ke Node E (Replica) |
| **Precondition** | Node E sebagai Replica |
| **Steps** | 1. `psql -h 10.30.110.113 -U groupware -c "SELECT pg_is_in_recovery();"` |
| **Expected** | Return `t` (true = in recovery) |
| **Actual** | |
| **Status** | ☐ Pass / ☐ Fail |
| **Notes** | |

---

## TC-04: Replikasi Data

| Item | Detail |
|------|--------|
| **Test ID** | TC-04 |
| **Title** | Data replication from Leader to Replica |
| **Precondition** | TC-01 passed |
| **Steps** | 1. `psql -h 10.30.110.112 -U groupware -c "CREATE DATABASE qatest;"` |
| | 2. `psql -h 10.30.110.112 -U groupware -d qatest -c "CREATE TABLE users (id serial, name text);"` |
| | 3. `psql -h 10.30.110.112 -U groupware -d qatest -c "INSERT INTO users (name) VALUES ('test1'),('test2');"` |
| | 4. `psql -h 10.30.110.113 -U groupware -d qatest -c "SELECT * FROM users;"` |
| **Expected** | Data `test1`, `test2` muncul di Replica |
| **Actual** | |
| **Status** | ☐ Pass / ☐ Fail |
| **Notes** | |

---

## TC-05: Failover — Leader Mati

| Item | Detail |
|------|--------|
| **Test ID** | TC-05 |
| **Title** | Failover otomatis saat Leader mati |
| **Precondition** | TC-04 passed, data `qatest` sudah tereplikasi |
| **Steps** | 1. Cek Leader: `patronictl list` |
| | 2. Matikan Patroni di Node D: `ssh root@10.30.110.128 "systemctl stop patroni"` |
| | 3. Tunggu 30 detik |
| | 4. Cek cluster: `patronictl list` |
| | 5. Cek koneksi via VIP: `psql -h 10.30.110.112 -U groupware -d qatest -c "SELECT count(*) FROM users;"` |
| | 6. Cek Leader baru: `psql -h 10.30.110.112 -U groupware -c "SELECT pg_is_in_recovery();"` |
| **Expected** | Node E jadi Leader, data tetap utuh (`count = 2`), `pg_is_in_recovery()` = `f` |
| **Actual** | |
| **Status** | ☐ Pass / ☐ Fail |
| **Notes** | |

---

## TC-06: Recovery — Leader Kembali sebagai Replica

| Item | Detail |
|------|--------|
| **Test ID** | TC-06 |
| **Title** | Node D kembali sebagai Replica setelah failover |
| **Precondition** | TC-05 passed, Node E sebagai Leader |
| **Steps** | 1. Start Patroni di Node D: `ssh root@10.30.110.128 "systemctl start patroni"` |
| | 2. Tunggu 30 detik |
| | 3. Cek cluster: `patronictl list` |
| | 4. Cek data: `psql -h 10.30.110.128 -U groupware -d qatest -c "SELECT count(*) FROM users;"` |
| **Expected** | Node D join sebagai Replica, data sinkron (`count = 2`) |
| **Actual** | |
| **Status** | ☐ Pass / ☐ Fail |
| **Notes** | |

---

## TC-07: Switchover Manual

| Item | Detail |
|------|--------|
| **Test ID** | TC-07 |
| **Title** | Switchover manual tanpa downtime |
| **Precondition** | Cluster sehat, Node D Leader, Node E Replica |
| **Steps** | 1. `patronictl switchover --master node-d --candidate node-e` |
| | 2. Ketik `y` untuk konfirmasi |
| | 3. Cek cluster: `patronictl list` |
| | 4. Cek koneksi: `psql -h 10.30.110.112 -U groupware -d qatest -c "SELECT 1;"` |
| **Expected** | Node E jadi Leader, Node D jadi Replica, koneksi tetap jalan |
| **Actual** | |
| **Status** | ☐ Pass / ☐ Fail |
| **Notes** | |

---

## TC-08: HAProxy Health Check — Block Replica

| Item | Detail |
|------|--------|
| **Test ID** | TC-08 |
| **Title** | HAProxy hanya routing ke `/master`, block Replica |
| **Precondition** | Cluster sehat |
| **Steps** | 1. Cek health check langsung ke Patroni API: |
| | `curl -s -o /dev/null -w "%{http_code}" http://10.30.110.128:8008/master` |
| | `curl -s -o /dev/null -w "%{http_code}" http://10.30.110.113:8008/master` |
| | 2. Cek HAProxy stats: `curl -u admin:admin123 http://10.30.110.114:8080/stats 2>/dev/null \| grep pg_node` |
| **Expected** | Leader return 200, Replica return 503. HAProxy hanya tampilkan Leader sebagai UP. |
| **Actual** | |
| **Status** | ☐ Pass / ☐ Fail |
| **Notes** | |

---

## TC-09: etcd Quorum — 1 Node Down

| Item | Detail |
|------|--------|
| **Test ID** | TC-09 |
| **Title** | etcd cluster tolerate 1 node failure |
| **Precondition** | etcd cluster 3 node sehat |
| **Steps** | 1. `etcdctl endpoint health --cluster -w table` |
| | 2. Stop etcd di Node C: `ssh root@10.30.110.116 "systemctl stop etcd"` |
| | 3. `etcdctl endpoint health --cluster -w table` |
| | 4. Cek Patroni masih jalan: `patronictl list` |
| | 5. Cek koneksi: `psql -h 10.30.110.112 -U groupware -c "SELECT 1;"` |
| **Expected** | 2/3 node sehat, cluster masih write, Patroni & DB tetap normal |
| **Actual** | |
| **Status** | ☐ Pass / ☐ Fail |
| **Notes** | |

---

## TC-10: etcd Quorum — 2 Nodes Down

| Item | Detail |
|------|--------|
| **Test ID** | TC-10 |
| **Title** | etcd cluster loses quorum (2 nodes down) |
| **Precondition** | TC-09 passed (Node C sudah mati) |
| **Steps** | 1. Stop etcd di Node B: `ssh root@10.30.110.115 "systemctl stop etcd"` |
| | 2. `etcdctl endpoint health --cluster` |
| | 3. Cek Patroni: `patronictl list` |
| | 4. Cek koneksi: `psql -h 10.30.110.112 -U groupware -c "SELECT 1;"` |
| **Expected** | etcd cluster read-only / error, Patroni mungkin turun, koneksi DB terputus |
| **Actual** | |
| **Status** | ☐ Pass / ☐ Fail |
| **Notes** | |

---

## TC-11: etcd Recovery dari Quorum Loss

| Item | Detail |
|------|--------|
| **Test ID** | TC-11 |
| **Title** | Recovery setelah quorum loss |
| **Precondition** | TC-10 passed |
| **Steps** | 1. Start etcd di Node B: `ssh root@10.30.110.115 "systemctl start etcd"` |
| | 2. Start etcd di Node C: `ssh root@10.30.110.116 "systemctl start etcd"` |
| | 3. Tunggu 10 detik |
| | 4. `etcdctl endpoint health --cluster -w table` |
| | 5. Cek Patroni: `patronictl list` |
| | 6. Cek koneksi: `psql -h 10.30.110.112 -U groupware -c "SELECT 1;"` |
| **Expected** | Semua kembali normal, quorum 3/3, Patroni recover, DB bisa diakses |
| **Actual** | |
| **Status** | ☐ Pass / ☐ Fail |
| **Notes** | |

---

## TC-12: VIP Movement — MASTER Down

| Item | Detail |
|------|--------|
| **Test ID** | TC-12 |
| **Title** | VIP pindah saat Keepalived MASTER mati |
| **Precondition** | VIP aktif di Node A |
| **Steps** | 1. Cek VIP: `ip addr show \| grep 10.30.110.112` di Node A |
| | 2. Matikan keepalived di Node A: `ssh root@10.30.110.114 "systemctl stop keepalived"` |
| | 3. Tunggu 5 detik |
| | 4. Cek VIP di Node B: `ssh root@10.30.110.115 "ip addr show \| grep 10.30.110.112"` |
| | 5. Cek koneksi: `psql -h 10.30.110.112 -U groupware -c "SELECT 1;"` |
| **Expected** | VIP pindah ke Node B, koneksi tetap jalan |
| **Actual** | |
| **Status** | ☐ Pass / ☐ Fail |
| **Notes** | |

---

## TC-13: VIP Movement — MASTER Kembali

| Item | Detail |
|------|--------|
| **Test ID** | TC-13 |
| **Title** | VIP kembali ke MASTER setelah MASTER hidup lagi |
| **Precondition** | TC-12 passed (VIP di Node B) |
| **Steps** | 1. Start keepalived di Node A: `ssh root@10.30.110.114 "systemctl start keepalived"` |
| | 2. Tunggu 5 detik |
| | 3. Cek VIP di Node A: `ip addr show \| grep 10.30.110.112` |
| | 4. Cek VIP di Node B (harus hilang): `ssh root@10.30.110.115 "ip addr show \| grep 10.30.110.112"` |
| | 5. Cek koneksi: `psql -h 10.30.110.112 -U groupware -c "SELECT 1;"` |
| **Expected** | VIP kembali ke Node A (priority lebih tinggi), koneksi tetap jalan |
| **Actual** | |
| **Status** | ☐ Pass / ☐ Fail |
| **Notes** | |

---

## TC-14: Total Recovery — Semua Node Mati

| Item | Detail |
|------|--------|
| **Test ID** | TC-14 |
| **Title** | Full cluster recovery after total outage |
| **Precondition** | Cluster running normal |
| **Steps** | 1. Matikan semua service: |
| | `ssh root@10.30.110.113 "systemctl stop patroni"` |
| | `ssh root@10.30.110.128 "systemctl stop patroni"` |
| | `ssh root@10.30.110.114 "systemctl stop keepalived haproxy etcd"` |
| | `ssh root@10.30.110.115 "systemctl stop keepalived haproxy etcd"` |
| | `ssh root@10.30.110.116 "systemctl stop etcd"` |
| | 2. Start etcd di A, B, C (simultaneous) |
| | 3. `etcdctl endpoint health --cluster` |
| | 4. Start Patroni di Node D |
| | 5. Start Patroni di Node E |
| | 6. Start HAProxy + Keepalived di Node A & B |
| | 7. Cek cluster: `patronictl list` |
| | 8. Cek koneksi: `psql -h 10.30.110.112 -U groupware -c "SELECT count(*) FROM qatest.users;"` |
| **Expected** | Cluster recover total, semua node normal, data intact |
| **Actual** | |
| **Status** | ☐ Pass / ☐ Fail |
| **Notes** | |

---

## TC-15: Patroni REST API

| Item | Detail |
|------|--------|
| **Test ID** | TC-15 |
| **Title** | Patroni REST API endpoints |
| **Precondition** | Cluster running |
| **Steps** | 1. `curl -s http://10.30.110.128:8008/cluster \| python3 -m json.tool` |
| | 2. `curl -s http://10.30.110.128:8008/health \| python3 -m json.tool` |
| | 3. `curl -s -o /dev/null -w "%{http_code}" http://10.30.110.128:8008/master` |
| | 4. `curl -s -o /dev/null -w "%{http_code}" http://10.30.110.113:8008/master` |
| | 5. `curl -s -o /dev/null -w "%{http_code}" http://10.30.110.113:8008/replica` |
| | 6. `curl -s http://10.30.110.128:8008/config \| python3 -m json.tool` |
| **Expected** | Semua endpoint return response valid, master/replica check sesuai role |
| **Actual** | |
| **Status** | ☐ Pass / ☐ Fail |
| **Notes** | |

---

## TC-16: Backup & Restore (pgBackRest)

| Item | Detail |
|------|--------|
| **Test ID** | TC-16 |
| **Title** | Backup dan restore menggunakan pgBackRest |
| **Precondition** | pgBackRest terinstall dan terkonfigurasi |
| **Steps** | 1. `pgbackrest --stanza=pg_cluster --type=full backup` |
| | 2. `pgbackrest --stanza=pg_cluster info` |
| | 3. `pgbackrest --stanza=pg_cluster restore` |
| **Expected** | Backup sukses, info menampilkan backup set, restore sukses |
| **Actual** | |
| **Status** | ☐ Pass / ☐ Fail |
| **Notes** | |

---

## Test Summary

| TC ID | Test Case | Status | Notes |
|-------|-----------|--------|-------|
| TC-01 | Connection via VIP | ☐ | |
| TC-02 | Direct connection to Leader | ☐ | |
| TC-03 | Direct connection to Replica | ☐ | |
| TC-04 | Data replication | ☐ | |
| TC-05 | Failover - Leader down | ☐ | |
| TC-06 | Recovery - former Leader returns | ☐ | |
| TC-07 | Manual switchover | ☐ | |
| TC-08 | HAProxy health check | ☐ | |
| TC-09 | etcd quorum - 1 node down | ☐ | |
| TC-10 | etcd quorum - 2 nodes down | ☐ | |
| TC-11 | etcd recovery from quorum loss | ☐ | |
| TC-12 | VIP movement - MASTER down | ☐ | |
| TC-13 | VIP movement - MASTER returns | ☐ | |
| TC-14 | Total recovery | ☐ | |
| TC-15 | Patroni REST API | ☐ | |
| TC-16 | Backup & restore | ☐ | |

**Total Test Cases:** 16  
**Passed:** ☐  
**Failed:** ☐  
**Not Tested:** ☐  

**Tester:** _________________  
**Date:** _________________
