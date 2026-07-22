# Archive, Synchronous Replication & Watchdog

**PG-HA Cluster | 20 July 2026**

---

## 1. Synchronous Replication

### Config

Di `bootstrap.dcs` di kedua node (`patroni-node-d-*.yml` dan `patroni-node-e-*.yml`):

```yaml
synchronous_mode: true
synchronous_mode_strict: false
synchronous_node_count: 1
primary_start_timeout: 300
```

- `true` = Patroni manage `synchronous_standby_names` otomatis
- `false` = Kalau replica down, master fallback ke async (write tetap jalan)
- `1` = Minimum 1 sync standby
- `300` = Tunggu max 5 menit untuk primary start setelah failover

### Behavior

| Kondisi | Hasil |
|---------|-------|
| Replica UP & streaming | `sync_state = sync` — commit menunggu konfirmasi replica |
| Replica DOWN | Fallback ke async — write tetap jalan tanpa delay |
| Replica kembali UP | Otomatis jadi sync lagi |

### Monitoring

```bash
# [on any node with psql access] Cek sync state
psql -c "SELECT application_name, state, sync_state, write_lag, flush_lag, replay_lag FROM pg_stat_replication;"

# [on any node] Cek current config
psql -c "SHOW synchronous_standby_names;"
psql -c "SHOW synchronous_commit;"
```

Expected:
```
 application_name |   state   | sync_state | write_lag | flush_lag | replay_lag
------------------+-----------+------------+-----------+-----------+------------
 node-e           | streaming | sync       | 0         | 0         | 0
```

### Skenario Failover

1. Master (Node D) mati → Patroni promote replica (Node E) jadi master baru
2. `synchronous_standby_names` otomatis di-update oleh Patroni
3. Node D join kembali sebagai replica → sync state pulih

```bash
# [on Node D] Simulasi failover — stop Patroni
sudo systemctl stop patroni

# [wait 30-60 detik, dari Node E]
patronictl list
# node-e = Leader, node-d = stopped

# [on Node D] Start kembali
sudo systemctl start patroni

# [on Node D / via VIP] Verifikasi sync
psql -c "SELECT application_name, state, sync_state FROM pg_stat_replication;"
# sync_state = sync
```

---

## 2. WAL Archive (pgBackRest)

### Pipeline

```
PostgreSQL WAL → archive_command → pgbackrest → /backup/pgbackrest/
                                                      ↓
Replica catch-up ← restore_command ← pgbackrest ← archive-get
```

### Config

**Patroni `postgresql.parameters`:**
```yaml
archive_mode: on
archive_command: 'pgbackrest --stanza=pg_cluster archive-push %p'
archive_timeout: 60
restore_command: 'pgbackrest --stanza=pg_cluster archive-get %f "%p"'
wal_keep_size: 32GB
```

**pgBackRest config (`/etc/pgbackrest/pgbackrest.conf`):**
```ini
[pg_cluster]
pg1-path=/var/lib/pgsql/16/data
pg1-port=5432
repo1-path=/backup/pgbackrest
repo1-retention-full=4
repo1-retention-diff=4
repo1-cipher-type=none

[global]
log-level-console=info
log-level-file=detail
compress-type=gz
process-max=2
```

### Setup

```bash
# [on Node D & E] 1. Install
sudo dnf install --disablerepo='*' --enablerepo=local-offline --allowerasing -y pgbackrest

# [on Node D & E] 2. Buat direktori
sudo mkdir -p /backup/pgbackrest
sudo chown postgres:postgres /backup/pgbackrest

# [on Node D & E] 3. Copy config
sudo cp /home/kbbadmin/pgbackrest.conf /etc/pgbackrest/pgbackrest.conf

# [on Node D] 4. Create stanza (cukup sekali di Leader)
sudo pgbackrest --stanza=pg_cluster stanza-create

# [on Node D] 5. Test archive
psql -c "SELECT pg_switch_wal();"
ls -la /backup/pgbackrest/

# [on Node D] 6. Cek info backup
sudo pgbackrest --stanza=pg_cluster info
```

### Reload / Restart

```bash
# [on Node D] archive_command, restore_command, wal_keep_size — bisa reload
sudo patronictl -c /etc/patroni/patroni.yml reload node-d

# [on Node E]
sudo patronictl -c /etc/patroni/patroni.yml reload node-e

# [on Node E] archive_mode = on — butuh restart (replica dulu)
sudo patronictl -c /etc/patroni/patroni.yml restart node-e

# [on Node D] lalu master
sudo patronictl -c /etc/patroni/patroni.yml restart node-d
```

### Verify

```bash
# [on Node D] Cek WAL sudah di-archive
sudo pgbackrest --stanza=pg_cluster info

# [on Node D] Cek apakah ada WAL gap
psql -c "SELECT * FROM pg_stat_archiver;"

# [on any node] Cek timeline + LSN
psql -c "SELECT timeline_id, pg_current_wal_lsn() FROM pg_control_checkpoint();"
```

---

## 3. Watchdog (Patroni + softdog)

Patroni watchdog memonitor kesehatan Patroni. Jika Patroni hang/crash selama lebih dari `safety_margin` detik, watchdog akan me-reset sistem (mencegah split-brain).

### Kernel Module

```bash
# [on Node D & E] Load softdog
sudo modprobe softdog
sudo sh -c 'echo softdog > /etc/modules-load.d/softdog.conf'

# [on Node D & E] Verifikasi
ls -la /dev/watchdog
cat /proc/devices | grep watchdog
```

### Patroni Config

```yaml
watchdog:
    mode: automatic
    device: /dev/watchdog
    safety_margin: 5
```

- `automatic` = Gunakan watchdog jika tersedia, tidak wajib
- `device` = Path ke watchdog device
- `safety_margin` = Waktu toleransi (detik) sebelum watchdog trigger reboot

### Verifikasi

```bash
# [on Node D] Cek watchdog status di Patroni API
curl -s http://10.30.110.128:8008/watchdog | python3 -m json.tool

# [on Node E]
curl -s http://10.30.110.113:8008/watchdog | python3 -m json.tool

# [on Node D & E] Cek dari log Patroni
sudo journalctl -u patroni --since '1 minute ago' | grep -i watchdog
```

Expected output:
```json
{
    "watchdog": {
        "mode": "automatic",
        "device": "/dev/watchdog",
        "safety_margin": 5,
        "state": "running"
    }
}
```

---

## 4. Test Scenarios

### TC-ARCH-01: Test Archive WAL

```bash
# [on Node D] 1. Trigger WAL switch
psql -c "SELECT pg_switch_wal();"
sleep 2

# [on Node D] 2. Cek archive
sudo pgbackrest --stanza=pg_cluster info
ls -la /backup/pgbackrest/

# [on Node D] 3. Cek archiver status
psql -c "SELECT * FROM pg_stat_archiver;"
```

**Expected:** WAL file ter-archive ke `/backup/pgbackrest/`, `last_archive_age` mendekati 0.

---

### TC-ARCH-02: Replica Stop + WAL Archive Catch-Up

Simulasi replica mati 2 hari, master tetap write, lalu replica join kembali.

```bash
# ========== Phase 1: Setup ==========
# [on Node D / via VIP] Buat test table
psql -h 10.30.110.112 -U postgres -c "
    CREATE TABLE IF NOT EXISTS archive_test (
        id serial primary key,
        data text,
        ts timestamptz default now()
    );
"

# [on Node D] Insert 100 rows
psql -U postgres -c "
    INSERT INTO archive_test (data) SELECT 'before_stop_' || n FROM generate_series(1,100) n;
"
psql -U postgres -c "SELECT count(*) FROM archive_test;"

# ========== Phase 2: Stop Replica ==========
# [on any node] Stop Node E
ssh root@10.30.110.113 "sudo systemctl stop patroni"
sleep 5
sudo patronictl -c /etc/patroni/patroni.yml list
# node-e = stopped

# ========== Phase 3: Write ke Master (async fallback) ==========
# [on Node D] Dengan strict:false, write tetap berjalan
psql -U postgres -c "
    INSERT INTO archive_test (data) SELECT 'during_stop_' || n FROM generate_series(1,500) n;
"
psql -U postgres -c "SELECT count(*) FROM archive_test;"
# count = 600

# [on Node D / via VIP] Simulasi 2 hari — generate WAL
psql -h 10.30.110.112 -U postgres -c "SELECT pg_switch_wal();"
sudo pgbackrest --stanza=pg_cluster info

# ========== Phase 4: Start Replica ==========
# [from any node] Start Node E
ssh root@10.30.110.113 "sudo systemctl start patroni"
sleep 30
sudo patronictl -c /etc/patroni/patroni.yml list
# node-d = Leader, node-e = Replica, streaming

# ========== Phase 5: Verifikasi data ==========
# [on Node E] Cek data di replica
psql -h 10.30.110.113 -U postgres -c "SELECT count(*) FROM archive_test;"
# count = 600 (sama dengan master)

# [on Node D / via VIP] Cek data di master
psql -h 10.30.110.112 -U postgres -c "SELECT count(*) FROM archive_test;"
# count = 600

# [on Node D] Cek sync state pulih
psql -c "SELECT application_name, state, sync_state FROM pg_stat_replication;"
# sync_state = sync
```

---

### TC-ARCH-03: Full Restore dari Archive

```bash
# [on Node D] 1. Cek backup tersedia
sudo pgbackrest --stanza=pg_cluster info

# [on Node D] 2. Ambil full backup
sudo pgbackrest --stanza=pg_cluster --type=full backup

# [on Node D] 3. Simulasi data loss — drop table
psql -U postgres -c "DROP TABLE IF EXISTS archive_test;"

# [on Node D] 4. Restore (stop Patroni dulu)
sudo systemctl stop patroni
sudo pgbackrest --stanza=pg_cluster restore
sudo systemctl start patroni
```

---

### TC-ARCH-04: Watchdog Verification

```bash
# [on Node D & E] 1. Cek device watchdog
ls -la /dev/watchdog

# [on Node D] 2. Cek Patroni watchdog status via API
curl -s http://10.30.110.128:8008/watchdog | python3 -m json.tool

# [on Node E]
curl -s http://10.30.110.113:8008/watchdog | python3 -m json.tool

# [on Node D & E] 3. Verifikasi lewat log Patroni
sudo journalctl -u patroni --since '1 hour ago' | grep -i watchdog
```

---

## 5. Parameter Tuning

Perbandingan config sebelum dan sesudah adopsi expert config:

| Parameter | Before | After | Notes |
|-----------|--------|-------|-------|
| `max_connections` | 200 | 500 | Aplikasi perlu lebih banyak koneksi |
| `shared_buffers` | 256MB | 16GB | RAM 64GB → 25% optimal |
| `effective_cache_size` | default | 48GB | 75% RAM |
| `maintenance_work_mem` | default | 6GB | Autovacuum & index rebuild |
| `work_mem` | default | 32MB | Per sort operation |
| `wal_buffers` | default | 16MB | Write-heavy workload |
| `max_prepared_transactions` | 0 | 200 | Untuk aplikasi yg pakai 2PC |
| `checkpoint_timeout` | default (5min) | 120min | Kurangi I/O spike |
| `checkpoint_completion_target` | 0.9 | 0.9 | Sama |
| `wal_keep_size` | 0 (default) | 32GB | Replica catch-up safety |
| `max_wal_size` | 1GB | 16GB | Checkpoint frequency |
| `min_wal_size` | 80MB | 2GB | Checkpoint WAL retention |
| `random_page_cost` | 4.0 (default) | 0.5 | SSD storage |
| `seq_page_cost` | 1.0 (default) | 1.0 | Default untuk SSD |
| `effective_io_concurrency` | 1 | 200 | SSD concurrent I/O |
| `max_worker_processes` | 8 | 16 | Parallel query |
| `autovacuum_worker_slots` | default | 8 | Lebih agresif vacuum |
| `synchronous_mode` | tidak ada | true | Data safety |
| `archive_mode` | off | on | WAL archiving |
| `archive_command` | - | pgbackrest | Archive WAL |
| `restore_command` | - | pgbackrest | Restore WAL |
| `shared_preload_libraries` | - | pg_stat_statements,pgaudit,... | Monitoring & security |
| `log_directory` | pgdata/log | /log/pgcls/postgres | Log terpisah |

---

## 6. Extensions

Yang di-load via `shared_preload_libraries`:

| Extension | Fungsi |
|-----------|--------|
| pg_stat_statements | Query performance monitoring |
| pgaudit | Audit log |
| passwordcheck | Password policy |
| pg_repack | Table bloat removal tanpa lock |
| pg_squeeze | Table bloat removal otomatis |
| tablefunc | Crosstab queries |
| pg_cron | Scheduled jobs di PostgreSQL |
| set_user | Session privilege escalation |
| pg_partman_bgw | Partition management |

### Install

```bash
# [on Node D & E]
sudo dnf install --disablerepo='*' --enablerepo=local-offline --allowerasing -y \
    postgresql16-contrib pgaudit16_16 pg_repack16 pg_squeeze16 \
    pg_cron16 set_user16 pg_partman16
```

### Create Extension di Database

```bash
# [on Node D] — cukup sekali di database (replikasi ke replica via slot)
psql -U postgres -c "CREATE EXTENSION IF NOT EXISTS pg_stat_statements;"
psql -U postgres -c "CREATE EXTENSION IF NOT EXISTS pg_repack;"
psql -U postgres -c "CREATE EXTENSION IF NOT EXISTS pg_squeeze;"
psql -U postgres -c "CREATE EXTENSION IF NOT EXISTS tablefunc;"
psql -U postgres -c "CREATE EXTENSION IF NOT EXISTS pg_cron;"
psql -U postgres -c "CREATE EXTENSION IF NOT EXISTS set_user;"
psql -U postgres -c "CREATE EXTENSION IF NOT EXISTS pg_partman;"
```

---

## 7. Implementation Order (On-Server)

```bash
# ==========================================
# RUN ON NODE D & E (SSH ke masing-masing)
# ==========================================

# [Node D & E] 1. Load softdog
sudo modprobe softdog
sudo sh -c 'echo softdog > /etc/modules-load.d/softdog.conf'

# [Node D & E] 2. Install pgbackrest
sudo dnf install --disablerepo='*' --enablerepo=local-offline --allowerasing -y pgbackrest

# [Node D & E] 3. Install extensions
sudo dnf install --disablerepo='*' --enablerepo=local-offline --allowerasing -y \
    postgresql16-contrib pgaudit16_16 pg_repack16 pg_squeeze16 \
    pg_cron16 set_user16 pg_partman16

# [Node D & E] 4. Create log directory
sudo mkdir -p /log/pgcls/postgres
sudo chown postgres:postgres /log/pgcls/postgres

# [Node D & E] 5. Create archive directory
sudo mkdir -p /backup/pgbackrest
sudo chown postgres:postgres /backup/pgbackrest

# [Node D & E] 6. Copy pgbackrest.conf
sudo cp /home/kbbadmin/pgbackrest.conf /etc/pgbackrest/pgbackrest.conf

# ==========================================
# RUN ON NODE D ONLY (Leader)
# ==========================================

# [Node D] 7. Create stanza
sudo pgbackrest --stanza=pg_cluster stanza-create

# [Node D] 8. Copy patroni config
sudo cp /home/kbbadmin/patroni-node-d-10.30.110.128.yml /etc/patroni/patroni.yml

# ==========================================
# RUN ON NODE E ONLY (Replica)
# ==========================================

# [Node E] 9. Copy patroni config
sudo cp /home/kbbadmin/patroni-node-e-10.30.110.113.yml /etc/patroni/patroni.yml

# ==========================================
# RUN ON NODE D (restart via Patroni)
# ==========================================

# [Node D] 10. Rolling restart — replica dulu
sudo patronictl -c /etc/patroni/patroni.yml restart node-e
sleep 10

# [Node D] 11. Restart master
sudo patronictl -c /etc/patroni/patroni.yml restart node-d

# [Node D] 12. Reload both nodes
sudo patronictl -c /etc/patroni/patroni.yml reload node-d
sudo patronictl -c /etc/patroni/patroni.yml reload node-e

# [Node D] 13. Apply sync mode via patronictl
sudo patronictl -c /etc/patroni/patroni.yml edit-config
# Tambah: synchronous_mode: true
# Tambah: synchronous_mode_strict: false
# Tambah: synchronous_node_count: 1

# ==========================================
# VERIFY (dari Node D)
# ==========================================

# [Node D] 14. Check cluster
sudo patronictl -c /etc/patroni/patroni.yml list
sudo etcdctl endpoint health --cluster -w table

# [Node D] 15. Check sync state
psql -c "SELECT application_name, state, sync_state FROM pg_stat_replication;"

# [Node D] 16. Test archive
psql -c "SELECT pg_switch_wal();"
sudo pgbackrest --stanza=pg_cluster info

# [Node D] 17. Check watchdog
curl -s http://10.30.110.128:8008/watchdog | python3 -m json.tool

# [Node D / via SSH to Node E] 18. Check watchdog Node E
ssh root@10.30.110.113 "curl -s http://10.30.110.113:8008/watchdog | python3 -m json.tool"

# [Node D] 19. Check shared_preload_libraries
psql -c "SHOW shared_preload_libraries;"

# [Node D] 20. Create extensions (direplikasi otomatis ke Node E)
psql -U postgres -c "CREATE EXTENSION IF NOT EXISTS pg_stat_statements;"
psql -U postgres -c "CREATE EXTENSION IF NOT EXISTS pg_repack;"
psql -U postgres -c "CREATE EXTENSION IF NOT EXISTS pg_squeeze;"
psql -U postgres -c "CREATE EXTENSION IF NOT EXISTS tablefunc;"
psql -U postgres -c "CREATE EXTENSION IF NOT EXISTS pg_cron;"
psql -U postgres -c "CREATE EXTENSION IF NOT EXISTS set_user;"
psql -U postgres -c "CREATE EXTENSION IF NOT EXISTS pg_partman;"

# [Node D] 21. Check log directory
ls -la /log/pgcls/postgres/
```

---

## 8. Troubleshooting

### Archive Lag

```bash
# [on Node D] Cek archiver
psql -c "SELECT * FROM pg_stat_archiver;"
# Jika last_archive_age > 60, ada bottleneck

# [on Node D] Cek WAL rate
psql -c "SELECT pg_wal_lsn_diff(pg_current_wal_lsn(), pg_last_wal_receive_lsn()) / 1024 / 1024 AS mb;"
```

### Replica Not Catching Up

```bash
# [on Node D] Cek gap
psql -c "SELECT pg_wal_lsn_diff(pg_current_wal_lsn(), replay_lsn) / 1024 / 1024 AS mb FROM pg_stat_replication;"
# Jika gap besar dan streaming stuck, archive akan membantu catch-up

# [on Node D] Force archive catch-up
sudo patronictl -c /etc/patroni/patroni.yml reinit node-e
```

### Watchdog Timeout

```bash
# [on Node D & E] Cek apakah softdog loaded
lsmod | grep softdog

# [on Node D & E] Cek Patroni log
sudo journalctl -u patroni -f | grep watchdog

# Jika watchdog trigger reboot karena safety_margin terlalu kecil:
# - Naikkan safety_margin ke 10-15 detik
# - Set mode: 'off' untuk sementara
```

### pgBackRest Stanza Conflict

```bash
# [on Node D] Re-create stanza jika ada error
sudo pgbackrest --stanza=pg_cluster --force stanza-create

# [on Node D] Cek log
sudo tail -100 /var/log/pgbackrest/pgbackrest.log
```

### Sync Mode Stuck

```bash
# [on any node] Jika sync_state = 'potential' terus-menerus
# Cek apakah replica benar-benar streaming
psql -h 10.30.110.113 -U postgres -c "SELECT pg_is_in_recovery();"

# [on Node D] Jika replica tidak sinkron, reset sync
sudo patronictl -c /etc/patroni/patroni.yml edit-config --set synchronous_mode_strict=false
# Nanti set balik setelah replica normal
```
