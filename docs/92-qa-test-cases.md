# QA Test Cases — PG-HA Cluster

**Project:** PostgreSQL High Availability Cluster  
**Tester:** Juan Akbar  
**Date:** 12–15 July 2026  

---

## Summary

| TC ID | Type | Title | Status |
|-------|------|-------|--------|
| TC-01 | Positive | Koneksi database via VIP | ☐ |
| TC-02 | Positive | Koneksi via VIP — user salah | ☐ |
| TC-03 | Positive | Koneksi langsung ke Leader | ☐ |
| TC-04 | Positive | Koneksi langsung ke Replica | ☐ |
| TC-05 | Positive | Replikasi data (INSERT) | ☐ |
| TC-06 | Negative | Replikasi data — write ke Replica (harus ditolak) | ☐ |
| TC-07 | Positive | Failover — Leader mati, Replica jadi Leader | ☐ |
| TC-08 | Positive | Recovery — Leader kembali sebagai Replica | ☐ |
| TC-09 | Positive | Switchover manual tanpa downtime | ☐ |
| TC-10 | Positive | HAProxy health check — block Replica | ☐ |
| TC-11 | Negative | HAProxy health check — akses ke port salah | ☐ |
| TC-12 | Positive | etcd quorum — 1 node down (masih aman) | ☐ |
| TC-13 | Negative | etcd quorum — 2 node down (cluster down) | ☐ |
| TC-14 | Positive | etcd recovery dari quorum loss | ☐ |
| TC-15 | Positive | VIP movement — MASTER down, pindah ke BACKUP | ☐ |
| TC-16 | Positive | VIP movement — MASTER kembali (preempt) | ☐ |
| TC-17 | Negative | Akses superuser postgres dari jaringan (harus ditolak) | ☐ |
| TC-18 | Positive | Total recovery — semua node mati lalu hidup | ☐ |
| TC-19 | Positive | Patroni REST API — semua endpoint | ☐ |
| TC-20 | Positive | Backup & restore pgBackRest | ☐ |

---

## TC-01: Koneksi Database via VIP (Positive)

| Item | Detail |
|------|--------|
| **TC ID** | TC-01 |
| **Type** | ✅ Positive |
| **Title** | Koneksi database via Virtual IP berhasil |
| **Precondition** | Cluster running, VIP aktif di Node A |
| **Steps** | 1. `psql -h 10.30.110.112 -p 5432 -U groupware -d postgres -c "SELECT 1 AS test;"` |
| **Expected** | Query sukses, return `1` |
| **Actual** | |
| **Status** | ☐ Pass / ☐ Fail |
| **Notes** | |

---

## TC-02: Koneksi Database via VIP — User Salah (Negative)

| Item | Detail |
|------|--------|
| **TC ID** | TC-02 |
| **Type** | ❌ Negative |
| **Title** | Koneksi via VIP menggunakan user yang tidak valid |
| **Precondition** | Cluster running, VIP aktif |
| **Steps** | 1. `psql -h 10.30.110.112 -p 5432 -U user_tidak_ada -d postgres -c "SELECT 1;"` |
| **Expected** | Koneksi ditolak: `FATAL: role "user_tidak_ada" does not exist` |
| **Actual** | |
| **Status** | ☐ Pass / ☐ Fail |
| **Notes** | |

---

## TC-03: Koneksi Langsung ke Leader (Positive)

| Item | Detail |
|------|--------|
| **TC ID** | TC-03 |
| **Type** | ✅ Positive |
| **Title** | Koneksi langsung ke Node D (Leader) |
| **Precondition** | Node D sebagai Leader |
| **Steps** | 1. `psql -h 10.30.110.128 -U groupware -c "SELECT pg_is_in_recovery();"` |
| **Expected** | Return `f` (false = not in recovery) |
| **Actual** | |
| **Status** | ☐ Pass / ☐ Fail |
| **Notes** | |

---

## TC-04: Koneksi Langsung ke Replica (Positive)

| Item | Detail |
|------|--------|
| **TC ID** | TC-04 |
| **Type** | ✅ Positive |
| **Title** | Koneksi langsung ke Node E (Replica) |
| **Precondition** | Node E sebagai Replica |
| **Steps** | 1. `psql -h 10.30.110.113 -U groupware -c "SELECT pg_is_in_recovery();"` |
| **Expected** | Return `t` (true = in recovery) |
| **Actual** | |
| **Status** | ☐ Pass / ☐ Fail |
| **Notes** | |

---

## TC-05: Replikasi Data — INSERT (Positive)

| Item | Detail |
|------|--------|
| **TC ID** | TC-05 |
| **Type** | ✅ Positive |
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

## TC-06: Replikasi — Write ke Replica (Negative)

| Item | Detail |
|------|--------|
| **TC ID** | TC-06 |
| **Type** | ❌ Negative |
| **Title** | Write ke Replica harus ditolak |
| **Precondition** | TC-05 passed |
| **Steps** | 1. `psql -h 10.30.110.113 -U groupware -d qatest -c "INSERT INTO users (name) VALUES ('harus_gagal');"` |
| **Expected** | Query error: `cannot execute INSERT in a read-only transaction` |
| **Actual** | |
| **Status** | ☐ Pass / ☐ Fail |
| **Notes** | |

---

## TC-07: Failover — Leader Mati (Positive)

| Item | Detail |
|------|--------|
| **TC ID** | TC-07 |
| **Type** | ✅ Positive |
| **Title** | Failover otomatis saat Leader mati |
| **Precondition** | TC-05 passed, data `qatest` sudah tereplikasi |
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

## TC-08: Recovery — Leader Kembali sebagai Replica (Positive)

| Item | Detail |
|------|--------|
| **TC ID** | TC-08 |
| **Type** | ✅ Positive |
| **Title** | Node D kembali sebagai Replica setelah failover |
| **Precondition** | TC-07 passed, Node E sebagai Leader |
| **Steps** | 1. Start Patroni di Node D: `ssh root@10.30.110.128 "systemctl start patroni"` |
| | 2. Tunggu 30 detik |
| | 3. Cek cluster: `patronictl list` |
| | 4. Cek data: `psql -h 10.30.110.128 -U groupware -d qatest -c "SELECT count(*) FROM users;"` |
| **Expected** | Node D join sebagai Replica, data sinkron (`count = 2`) |
| **Actual** | |
| **Status** | ☐ Pass / ☐ Fail |
| **Notes** | |

---

## TC-09: Switchover Manual (Positive)

| Item | Detail |
|------|--------|
| **TC ID** | TC-09 |
| **Type** | ✅ Positive |
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

## TC-10: HAProxy Health Check — Block Replica (Positive)

| Item | Detail |
|------|--------|
| **TC ID** | TC-10 |
| **Type** | ✅ Positive |
| **Title** | HAProxy hanya routing ke `/master`, block Replica |
| **Precondition** | Cluster sehat |
| **Steps** | 1. Cek health check langsung ke Patroni API: |
| | `curl -s -o /dev/null -w "%{http_code}" http://10.30.110.128:8008/master` |
| | `curl -s -o /dev/null -w "%{http_code}" http://10.30.110.113:8008/master` |
| | 2. Cek HAProxy stats: `curl -u admin:admin123 http://10.30.110.114:8080/stats \| grep pg_node` |
| **Expected** | Leader return 200, Replica return 503. HAProxy hanya tampilkan Leader sebagai UP. |
| **Actual** | |
| **Status** | ☐ Pass / ☐ Fail |
| **Notes** | |

---

## TC-11: HAProxy — Akses Port Salah (Negative)

| Item | Detail |
|------|--------|
| **TC ID** | TC-11 |
| **Type** | ❌ Negative |
| **Title** | Koneksi ke port yang tidak dilayani HAProxy |
| **Precondition** | Cluster running, VIP aktif |
| **Steps** | 1. `psql -h 10.30.110.112 -p 5433 -U groupware -c "SELECT 1;"` |
| | 2. `curl -s -o /dev/null -w "%{http_code}" http://10.30.110.112:9999` |
| **Expected** | Koneksi ditolak / timeout, tidak ada response |
| **Actual** | |
| **Status** | ☐ Pass / ☐ Fail |
| **Notes** | |

---

## TC-12: etcd Quorum — 1 Node Down (Positive)

| Item | Detail |
|------|--------|
| **TC ID** | TC-12 |
| **Type** | ✅ Positive |
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

## TC-13: etcd Quorum — 2 Nodes Down (Negative)

| Item | Detail |
|------|--------|
| **TC ID** | TC-13 |
| **Type** | ❌ Negative |
| **Title** | etcd cluster loses quorum (2 nodes down) |
| **Precondition** | TC-12 passed (Node C sudah mati) |
| **Steps** | 1. Stop etcd di Node B: `ssh root@10.30.110.115 "systemctl stop etcd"` |
| | 2. `etcdctl endpoint health --cluster` |
| | 3. Cek Patroni: `patronictl list` |
| | 4. Cek koneksi: `psql -h 10.30.110.112 -U groupware -c "SELECT 1;"` |
| **Expected** | etcd cluster read-only / error, Patroni mungkin turun, koneksi DB terputus |
| **Actual** | |
| **Status** | ☐ Pass / ☐ Fail |
| **Notes** | |

---

## TC-14: etcd Recovery dari Quorum Loss (Positive)

| Item | Detail |
|------|--------|
| **TC ID** | TC-14 |
| **Type** | ✅ Positive |
| **Title** | Recovery setelah quorum loss |
| **Precondition** | TC-13 passed |
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

## TC-15: VIP Movement — MASTER Down (Positive)

| Item | Detail |
|------|--------|
| **TC ID** | TC-15 |
| **Type** | ✅ Positive |
| **Title** | VIP pindah saat Keepalived MASTER mati |
| **Precondition** | VIP aktif di Node A |
| **Steps** | 1. Cek VIP di Node A: `ip addr show \| grep 10.30.110.112` |
| | 2. Matikan keepalived di Node A: `ssh root@10.30.110.114 "systemctl stop keepalived"` |
| | 3. Tunggu 5 detik |
| | 4. Cek VIP di Node B: `ssh root@10.30.110.115 "ip addr show \| grep 10.30.110.112"` |
| | 5. Cek koneksi: `psql -h 10.30.110.112 -U groupware -c "SELECT 1;"` |
| **Expected** | VIP pindah ke Node B, koneksi tetap jalan |
| **Actual** | |
| **Status** | ☐ Pass / ☐ Fail |
| **Notes** | |

---

## TC-16: VIP Movement — MASTER Kembali (Positive)

| Item | Detail |
|------|--------|
| **TC ID** | TC-16 |
| **Type** | ✅ Positive |
| **Title** | VIP kembali ke MASTER setelah MASTER hidup lagi |
| **Precondition** | TC-15 passed (VIP di Node B) |
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

## TC-17: Akses Superuser postgres dari Jaringan (Negative)

| Item | Detail |
|------|--------|
| **TC ID** | TC-17 |
| **Type** | ❌ Negative |
| **Title** | Akses user postgres dari jaringan harus ditolak |
| **Precondition** | Cluster running, Patroni config `pg_hba` sudah benar |
| **Steps** | 1. Dari Node A: `psql -h 10.30.110.128 -U postgres -c "SELECT 1;"` |
| | 2. Dari Node B: `psql -h 10.30.110.113 -U postgres -c "SELECT 1;"` |
| | 3. Via VIP: `psql -h 10.30.110.112 -U postgres -c "SELECT 1;"` |
| **Expected** | Semua koneksi ditolak: `FATAL: no pg_hba.conf entry` |
| **Actual** | |
| **Status** | ☐ Pass / ☐ Fail |
| **Notes** | Hanya localhost (127.0.0.1) yang boleh akses postgres |

---

## TC-18: Total Recovery — Semua Node Mati (Positive)

| Item | Detail |
|------|--------|
| **TC ID** | TC-18 |
| **Type** | ✅ Positive |
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
| | 8. Cek koneksi: `psql -h 10.30.110.112 -U groupware -d qatest -c "SELECT count(*) FROM users;"` |
| **Expected** | Cluster recover total, semua node normal, data intact |
| **Actual** | |
| **Status** | ☐ Pass / ☐ Fail |
| **Notes** | |

---

## TC-19: Patroni REST API (Positive)

| Item | Detail |
|------|--------|
| **TC ID** | TC-19 |
| **Type** | ✅ Positive |
| **Title** | Patroni REST API endpoints |
| **Precondition** | Cluster running |
| **Steps** | 1. `curl -s http://10.30.110.128:8008/cluster \| python3 -m json.tool` |
| | 2. `curl -s http://10.30.110.128:8008/health \| python3 -m json.tool` |
| | 3. `curl -s -o /dev/null -w "%{http_code}" http://10.30.110.128:8008/master` |
| | 4. `curl -s -o /dev/null -w "%{http_code}" http://10.30.110.113:8008/master` |
| | 5. `curl -s -o /dev/null -w "%{http_code}" http://10.30.110.113:8008/replica` |
| **Expected** | Semua endpoint return response valid, master/replica check sesuai role |
| **Actual** | |
| **Status** | ☐ Pass / ☐ Fail |
| **Notes** | |

---

## TC-20: Backup & Restore pgBackRest (Positive)

| Item | Detail |
|------|--------|
| **TC ID** | TC-20 |
| **Type** | ✅ Positive |
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

## Test Result Summary

| | Positive | Negative | Total |
|----|---------|----------|-------|
| **Total** | 15 | 5 | **20** |
| **Passed** | | | |
| **Failed** | | | |
| **Not Tested** | | | |

**Tester:** _________________  
**Date:** _________________
