# QA Test Cases — PG-HA Cluster

**Project:** PostgreSQL High Availability Cluster  
**Tester:** Juan Akbar  
**Date:** 12–15 July 2026  

---

## Positive Test Cases

| No | Scenario | Description | Test Steps | Expected | Actual | Status | Notes | Type |
|----|----------|-------------|------------|----------|--------|--------|-------|------|
| 1 | TC-01 — Koneksi via VIP | Koneksi database via Virtual IP berhasil | `psql -h 10.30.110.112 -p 5432 -U groupware -d postgres -c "SELECT 1 AS test;"` | Query sukses, return `1` | | ☐ Pass / ☐ Fail | | Positive |
| 2 | TC-03 — Koneksi ke Leader | Koneksi langsung ke Node D (Leader) | `psql -h 10.30.110.128 -U groupware -c "SELECT pg_is_in_recovery();"` | Return `f` (false = not in recovery) | | ☐ Pass / ☐ Fail | | Positive |
| 3 | TC-04 — Koneksi ke Replica | Koneksi langsung ke Node E (Replica) | `psql -h 10.30.110.113 -U groupware -c "SELECT pg_is_in_recovery();"` | Return `t` (true = in recovery) | | ☐ Pass / ☐ Fail | | Positive |
| 4 | TC-05 — Replikasi Data | Data replication from Leader to Replica | 1. `psql -h 10.30.110.112 -U groupware -c "CREATE DATABASE qatest;"`<br>2. `psql -h 10.30.110.112 -U groupware -d qatest -c "CREATE TABLE users (id serial, name text);"`<br>3. `psql -h 10.30.110.112 -U groupware -d qatest -c "INSERT INTO users (name) VALUES ('test1'),('test2');"`<br>4. `psql -h 10.30.110.113 -U groupware -d qatest -c "SELECT * FROM users;"` | Data `test1`, `test2` muncul di Replica | | ☐ Pass / ☐ Fail | | Positive |
| 5 | TC-07 — Failover | Failover otomatis saat Leader mati | 1. Cek Leader: `patronictl list`<br>2. Matikan Patroni di Node D: `ssh root@10.30.110.128 "systemctl stop patroni"`<br>3. Tunggu 30 detik<br>4. Cek cluster: `patronictl list`<br>5. Cek koneksi: `psql -h 10.30.110.112 -U groupware -d qatest`<br>6. Cek Leader baru: `psql -h 10.30.110.112 -U groupware -c "SELECT pg_is_in_recovery();"` | Node E jadi Leader, data utuh (`count = 2`), `pg_is_in_recovery()` = `f` | | ☐ Pass / ☐ Fail | | Positive |
| 6 | TC-08 — Recovery | Node D kembali sebagai Replica setelah failover | 1. Start Patroni di Node D: `ssh root@10.30.110.128 "systemctl start patroni"`<br>2. Tunggu 30 detik<br>3. Cek cluster: `patronictl list`<br>4. Cek data: `psql -h 10.30.110.128 -U groupware -d qatest -c "SELECT count(*) FROM users;"` | Node D join sebagai Replica, data sinkron (`count = 2`) | | ☐ Pass / ☐ Fail | | Positive |
| 7 | TC-09 — Switchover | Switchover manual tanpa downtime | 1. `patronictl switchover --master node-d --candidate node-e`<br>2. Ketik `y`<br>3. Cek cluster: `patronictl list`<br>4. Cek koneksi: `psql -h 10.30.110.112 -U groupware -d qatest -c "SELECT 1;"` | Node E jadi Leader, Node D jadi Replica, koneksi tetap jalan | | ☐ Pass / ☐ Fail | | Positive |
| 8 | TC-10 — HAProxy Health Check | HAProxy hanya routing ke `/master`, block Replica | 1. Cek health: `curl -s -o /dev/null -w "%{http_code}" http://10.30.110.128:8008/master`<br>2. Cek Replica: `curl -s -o /dev/null -w "%{http_code}" http://10.30.110.113:8008/master`<br>3. Cek HAProxy stats: `curl -u admin:admin123 http://10.30.110.114:8080/stats` | Leader return 200, Replica return 503 | | ☐ Pass / ☐ Fail | | Positive |
| 9 | TC-12 — etcd Quorum 1 Down | etcd cluster tolerate 1 node failure | 1. `etcdctl endpoint health --cluster -w table`<br>2. Stop etcd di Node C: `ssh root@10.30.110.116 "systemctl stop etcd"`<br>3. `etcdctl endpoint health --cluster -w table`<br>4. Cek Patroni: `patronictl list`<br>5. Cek koneksi: `psql -h 10.30.110.112 -U groupware -c "SELECT 1;"` | 2/3 node sehat, cluster masih write, DB normal | | ☐ Pass / ☐ Fail | | Positive |
| 10 | TC-14 — etcd Recovery | Recovery setelah quorum loss | 1. Start etcd di Node B: `ssh root@10.30.110.115 "systemctl start etcd"`<br>2. Start etcd di Node C: `ssh root@10.30.110.116 "systemctl start etcd"`<br>3. `etcdctl endpoint health --cluster -w table`<br>4. Cek Patroni: `patronictl list`<br>5. Cek koneksi: `psql -h 10.30.110.112 -U groupware -c "SELECT 1;"` | Semua normal, quorum 3/3, DB bisa diakses | | ☐ Pass / ☐ Fail | TC-13 harus sudah dijalankan dulu | Positive |
| 11 | TC-15 — VIP Movement Down | VIP pindah saat Keepalived MASTER mati | 1. Cek VIP di Node A: `ip addr show | grep 10.30.110.112`<br>2. Stop keepalived di A: `ssh root@10.30.110.114 "systemctl stop keepalived"`<br>3. Cek VIP di Node B: `ssh root@10.30.110.115 "ip addr show | grep 10.30.110.112"`<br>4. Cek koneksi: `psql -h 10.30.110.112 -U groupware -c "SELECT 1;"` | VIP pindah ke Node B, koneksi tetap jalan | | ☐ Pass / ☐ Fail | | Positive |
| 12 | TC-16 — VIP Movement Up | VIP kembali ke MASTER setelah MASTER hidup lagi | 1. Start keepalived di A: `ssh root@10.30.110.114 "systemctl start keepalived"`<br>2. Cek VIP di Node A: `ip addr show | grep 10.30.110.112`<br>3. Cek VIP di Node B (harus hilang): `ssh root@10.30.110.115 "ip addr show | grep 10.30.110.112"`<br>4. Cek koneksi: `psql -h 10.30.110.112 -U groupware -c "SELECT 1;"` | VIP kembali ke Node A, koneksi tetap jalan | | ☐ Pass / ☐ Fail | | Positive |
| 13 | TC-18 — Total Recovery | Full cluster recovery after total outage | 1. Matikan semua service di semua node<br>2. Start etcd di A, B, C<br>3. Start Patroni di Node D<br>4. Start Patroni di Node E<br>5. Start HAProxy + Keepalived di A, B<br>6. Cek cluster: `patronictl list`<br>7. Cek koneksi: `psql -h 10.30.110.112 -U groupware -d qatest -c "SELECT count(*) FROM users;"` | Cluster recover total, semua node normal, data intact | | ☐ Pass / ☐ Fail | Ikuti urutan startup yang benar | Positive |
| 14 | TC-19 — Patroni API | Patroni REST API endpoints | 1. `curl -s http://10.30.110.128:8008/cluster | python3 -m json.tool`<br>2. `curl -s http://10.30.110.128:8008/health | python3 -m json.tool`<br>3. `curl -s -o /dev/null -w "%{http_code}" http://10.30.110.128:8008/master`<br>4. `curl -s -o /dev/null -w "%{http_code}" http://10.30.110.113:8008/replica` | Semua return valid, sesuai role | | ☐ Pass / ☐ Fail | | Positive |
| 15 | TC-20 — Backup Restore | Backup dan restore pgBackRest | 1. `pgbackrest --stanza=pg_cluster --type=full backup`<br>2. `pgbackrest --stanza=pg_cluster info` | Backup sukses, info tampilkan backup set | | ☐ Pass / ☐ Fail | | Positive |

---

## Negative Test Cases

| No | Scenario | Description | Test Steps | Expected | Actual | Status | Notes | Type |
|----|----------|-------------|------------|----------|--------|--------|-------|------|
| 1 | TC-02 — Koneksi User Salah | Koneksi via VIP menggunakan user tidak valid | `psql -h 10.30.110.112 -p 5432 -U user_tidak_ada -d postgres -c "SELECT 1;"` | `FATAL: role "user_tidak_ada" does not exist` | | ☐ Pass / ☐ Fail | | Negative |
| 2 | TC-06 — Write ke Replica | Write ke Replica harus ditolak | `psql -h 10.30.110.113 -U groupware -d qatest -c "INSERT INTO users (name) VALUES ('harus_gagal');"` | `cannot execute INSERT in a read-only transaction` | | ☐ Pass / ☐ Fail | TC-05 harus sudah dijalankan | Negative |
| 3 | TC-11 — Port Salah | Koneksi ke port yang tidak dilayani HAProxy | 1. `psql -h 10.30.110.112 -p 5433 -U groupware -c "SELECT 1;"`<br>2. `curl -s -o /dev/null -w "%{http_code}" http://10.30.110.112:9999` | Koneksi ditolak / timeout | | ☐ Pass / ☐ Fail | | Negative |
| 4 | TC-13 — etcd Quorum 2 Down | etcd cluster loses quorum (2 nodes down) | 1. Stop etcd di Node B: `ssh root@10.30.110.115 "systemctl stop etcd"`<br>2. `etcdctl endpoint health --cluster`<br>3. Cek Patroni: `patronictl list`<br>4. Cek koneksi: `psql -h 10.30.110.112 -U groupware -c "SELECT 1;"` | etcd read-only, Patroni turun, koneksi terputus | | ☐ Pass / ☐ Fail | TC-12 harus sudah dijalankan (Node C mati) | Negative |
| 5 | TC-17 — Superuser dari Jaringan | Akses user postgres dari jaringan harus ditolak | 1. Dari Node A: `psql -h 10.30.110.128 -U postgres -c "SELECT 1;"`<br>2. Dari Node B: `psql -h 10.30.110.113 -U postgres -c "SELECT 1;"`<br>3. Via VIP: `psql -h 10.30.110.112 -U postgres -c "SELECT 1;"` | `FATAL: no pg_hba.conf entry` | | ☐ Pass / ☐ Fail | Hanya localhost yang boleh akses postgres | Negative |

---

## Test Result Summary

| | Positive | Negative | Total |
|----|---------|----------|-------|
| **Total** | 15 | 5 | **20** |
| **Passed** | | | |
| **Failed** | | | |
| **Not Tested** | | | |

**Tester:** _________________ &nbsp;&nbsp; **Date:** _________________
