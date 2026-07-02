# Handover Checklist — PG-HA Cluster

**Project:** PostgreSQL High Availability Cluster  
**Handover Date:** 15-July-2026  
**From:** Juan Akbar  
**To:** Operations Team  

---

## 1. Cluster Topology

| Node | IP | Services | Status |
|------|----|----------|--------|
| A | 10.30.110.114 | etcd2 + HAProxy + Keepalived MASTER | ✅ |
| B | 10.30.110.115 | etcd1 + HAProxy + Keepalived BACKUP | ✅ |
| C | 10.30.110.116 | etcd3 (consensus) | ✅ |
| D | 10.30.110.128 | Patroni + PostgreSQL Leader | ✅ |
| E | 10.30.110.113 | Patroni + PostgreSQL Replica | ✅ |
| VIP | 10.30.110.112 | Virtual IP (Keepalived) | ✅ |

---

## 2. Credentials

| User | Password | Fungsi |
|------|----------|--------|
| `postgres` | `postgres_pass` | Admin superuser (localhost only) |
| `replicator` | `replicator_pass` | Streaming replication |
| `rewind_user` | `rewind_pass` | pg_rewind |
| `groupware` | `KBBgroupware@2025!` | **Aplikasi (via VIP)** |

**DB_URL:**
```
postgresql://groupware:KBBgroupware@2025!@10.30.110.112:5432/nama_database
```

---

## 3. Service Status

```bash
# Check all services
ssh root@10.30.110.114 "systemctl status etcd haproxy keepalived --no-pager"
ssh root@10.30.110.115 "systemctl status etcd haproxy keepalived --no-pager"
ssh root@10.30.110.116 "systemctl status etcd --no-pager"
ssh root@10.30.110.128 "systemctl status patroni --no-pager"
ssh root@10.30.110.113 "systemctl status patroni --no-pager"

# Cluster health
patronictl -c /etc/patroni/patroni.yml list
etcdctl endpoint health --cluster -w table
```

---

## 4. Lokasi File Penting

| File | Lokasi |
|------|--------|
| Patroni config | `/etc/patroni/patroni.yml` (Node D & E) |
| etcd config | `/etc/etcd/etcd.conf` (Node A, B, C) |
| HAProxy config | `/etc/haproxy/haproxy.cfg` (Node A & B) |
| Keepalived config | `/etc/keepalived/keepalived.conf` (Node A & B) |
| Offline repo | `/home/kbbadmin/offline-rpms/` |
| Bundle RPM | `/home/kbbadmin/pgha-offline-bundle.tar.gz` |
| Project docs | `/home/xavier/DBFAILOVER/docs/` |
| Config files | `/home/xavier/DBFAILOVER/configs/` |

---

## 5. Daily Operations

### Cek Cluster

```bash
patronictl -c /etc/patroni/patroni.yml list
```

### Switchover Manual

```bash
patronictl -c /etc/patroni/patroni.yml switchover
```

### Restart Service

```bash
systemctl restart patroni      # Node D/E
systemctl restart haproxy       # Node A/B
systemctl restart keepalived    # Node A/B
systemctl restart etcd          # Node A/B/C
```

### Cek Log

```bash
journalctl -u patroni -n 50 --no-pager
journalctl -u etcd -n 50 --no-pager
journalctl -u haproxy -n 50 --no-pager
journalctl -u keepalived -n 50 --no-pager
```

---

## 6. Dokumen Terlampir

| Doc | File |
|-----|------|
| Installation order | `docs/00-installation-order.md` |
| Node A (MASTER) | `docs/01-install-node-a-10.30.110.114.md` |
| Node B (BACKUP) | `docs/02-install-node-b-10.30.110.115.md` |
| Node C (etcd) | `docs/03-install-node-c-10.30.110.116.md` |
| Node D (Leader) | `docs/04-install-node-d-10.30.110.128.md` |
| Node E (Replica) | `docs/05-install-node-e-10.30.110.113.md` |
| User management | `docs/06-user-management.md` |
| Testing scenarios | `docs/98-testing-scenarios.md` |
| Clean install | `docs/99-clean-install-all-nodes.md` |
| Backup strategy | `docs/91-backup-strategy.md` |
| WBS timeline | `docs/97-wbs-timeline.md` |

---

## 7. Handover Sign-off

| Role | Name | Signature | Date |
|------|------|-----------|------|
| Project Lead | Juan Akbar | | |
| Operations | | | |

**Notes:**
- 
- 
- 
