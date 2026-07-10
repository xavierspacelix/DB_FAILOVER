# WBS Timeline — PG-HA Cluster Deployment

**Start Date:** 02-July-2026  
**Target OS:** RHEL / Rocky Linux 9.x  
**Project Lead:** Juan Akbar  
**Working Days:** Monday – Friday (no weekends)

---

| WBS NUMBER | TASK TITLE | PIC | TASK OWNER | Timeline Awal | | Actual Timeline | | DELIVERABLE | DEPENDENCY |
|---|---|---|---|---|---|---|---|---|---|
| | | | | START DATE | DUE DATE | ACTUAL START | ACTUAL DUE | | |
| | **Phase 1 — Preparation** | | | **02-Jul** | **03-Jul** | | | | |
| 1.1 | Setup builder + enable EPEL & PGDG repo | Juan Akbar | | 02-Jul | 02-Jul | | | Builder environment ready | - |
| 1.2 | Install createrepo_c | Juan Akbar | | 02-Jul | 02-Jul | | | createrepo_c installed | 1.1 |
| 1.3 | Verify package availability | Juan Akbar | | 02-Jul | 02-Jul | | | Package list confirmed | 1.2 |
| 1.4 | Download all RPMs (275 packages) | Juan Akbar | | 03-Jul | 03-Jul | | | 274 RPMs downloaded | 1.1–1.3 |
| 1.5 | Build local repo (createrepo_c) | Juan Akbar | | 03-Jul | 03-Jul | | | Local repo (repodata) | 1.4 |
| 1.6 | Package bundle (pgha-offline-bundle-10-Jul-2026.tar.gz) | Juan Akbar | | 03-Jul | 03-Jul | | | offline bundle 134MB | 1.5 |
| 1.7 | Test offline install on builder VM | Juan Akbar | | 03-Jul | 03-Jul | | | Install test passed | 1.6 |
| **M1** | **Milestone: Bundle RPM ready for deployment** | | | **03-Jul** | **03-Jul** | | | **Bundle approved** | |
| | **Phase 2 — Deploy etcd Cluster** | | | **06-Jul** | **08-Jul** | | | | |
| 2.1 | Transfer bundle to Node A/B/C (.114/.115/.116) | Juan Akbar | | 06-Jul | 06-Jul | | | Bundle delivered to nodes | 1.7 |
| 2.2 | Setup local repo on Node A, B, C | Juan Akbar | | 06-Jul | 06-Jul | | | local-offline.repo configured | 2.1 |
| 2.3 | Install etcd on Node A, B, C | Juan Akbar | | 07-Jul | 07-Jul | | | etcd installed on 3 nodes | 2.2 |
| 2.4 | Configure etcd (update conf per node) | Juan Akbar | | 07-Jul | 07-Jul | | | etcd.conf per node | 2.3 |
| 2.5 | Start etcd cluster (A+B+C simultaneously) | Juan Akbar | | 08-Jul | 08-Jul | | | etcd cluster running | 2.4 |
| 2.6 | Verify etcd quorum (3/3 healthy) | Juan Akbar | | 08-Jul | 08-Jul | | | Quorum achieved | 2.5 |
| **M2** | **Milestone: etcd 3-node cluster quorum achieved** | | | **08-Jul** | **08-Jul** | | | **etcd OK** | |
| | **Phase 3 — Deploy Patroni + PostgreSQL** | | | **08-Jul** | **10-Jul** | | | | |
| 3.1 | Transfer bundle + repo to Node D (.128) | Juan Akbar | | 08-Jul | 08-Jul | | | Bundle delivered to .128 | 2.6 |
| 3.2 | Verify existing PostgreSQL parameters on .128 | Juan Akbar | | 08-Jul | 08-Jul | | | Config check report | - |
| 3.3 | Install patroni + patroni-etcd on Node D | Juan Akbar | | 09-Jul | 09-Jul | | | Patroni installed on .128 | 3.1 |
| 3.4 | Configure Patroni Node D (existing data) | Juan Akbar | | 09-Jul | 09-Jul | | | patroni.yml for existing DB | 3.2–3.3 |
| 3.5 | Stop old PostgreSQL, start Patroni on Node D | Juan Akbar | | 09-Jul | 09-Jul | | | Patroni running as Leader | 3.4 |
| 3.6 | Verify Node D as Leader + data intact | Juan Akbar | | 09-Jul | 09-Jul | | | Data verified intact | 3.5 |
| 3.7 | Transfer bundle + repo to Node E (.113) | Juan Akbar | | 10-Jul | 10-Jul | | | Bundle delivered to .113 | 3.6 |
| 3.8 | Install patroni + patroni-etcd on Node E | Juan Akbar | | 10-Jul | 10-Jul | | | Patroni installed on .113 | 3.7 |
| 3.9 | Configure Patroni Node E (Replica) | Juan Akbar | | 10-Jul | 10-Jul | | | patroni.yml for Replica | 3.8 |
| 3.10 | Start Patroni on Node E (auto-join as Replica) | Juan Akbar | | 10-Jul | 10-Jul | | | Node E joined as Replica | 3.9 |
| 3.11 | Verify streaming replication (Leader → Replica) | Juan Akbar | | 10-Jul | 10-Jul | | | Replication confirmed | 3.10 |
| **M3** | **Milestone: Patroni cluster + replication running** | | | **10-Jul** | **10-Jul** | | | **Patroni OK** | |
| | **Phase 4 — Deploy HAProxy + Keepalived** | | | **13-Jul** | **14-Jul** | | | | |
| 4.1 | Transfer bundle + repo to Node A (.114) & B (.115) | Juan Akbar | | 13-Jul | 13-Jul | | | Bundle on .114 & .115 | 3.11 |
| 4.2 | Install haproxy + keepalived on Node A & B | Juan Akbar | | 13-Jul | 13-Jul | | | Packages installed | 4.1 |
| 4.3 | Configure HAProxy (same on Node A & B) | Juan Akbar | | 13-Jul | 13-Jul | | | haproxy.cfg deployed | 4.2 |
| 4.4 | Start HAProxy on Node A & B | Juan Akbar | | 13-Jul | 13-Jul | | | HAProxy running | 4.3 |
| 4.5 | Configure Keepalived MASTER on Node A | Juan Akbar | | 14-Jul | 14-Jul | | | keepalived-master.conf | 4.4 |
| 4.6 | Configure Keepalived BACKUP on Node B | Juan Akbar | | 14-Jul | 14-Jul | | | keepalived-backup.conf | 4.4 |
| 4.7 | Start Keepalived on Node A & B | Juan Akbar | | 14-Jul | 14-Jul | | | Keepalived running | 4.5–4.6 |
| 4.8 | Verify VIP 10.30.110.112 active on MASTER | Juan Akbar | | 14-Jul | 14-Jul | | | VIP confirmed active | 4.7 |
| **M4** | **Milestone: HAProxy + Keepalived + VIP operational** | | | **14-Jul** | **14-Jul** | | | **Network HA OK** | |
| | **Phase 5 — Testing (QA Test Cases)** | | | **14-Jul** | **15-Jul** | | | | |
| 5.1 | TC-01: Connection via VIP (Positive) | Juan Akbar | | 14-Jul | 14-Jul | | | Connection test passed | 4.8 |
| 5.2 | TC-02: Connection via VIP — wrong user (Negative) | Juan Akbar | | 14-Jul | 14-Jul | | | Connection rejected as expected | 5.1 |
| 5.3 | TC-03: Direct connection to Leader (Positive) | Juan Akbar | | 14-Jul | 14-Jul | | | `pg_is_in_recovery()` = f | 5.2 |
| 5.4 | TC-04: Direct connection to Replica (Positive) | Juan Akbar | | 14-Jul | 14-Jul | | | `pg_is_in_recovery()` = t | 5.3 |
| 5.5 | TC-05: Data replication INSERT (Positive) | Juan Akbar | | 14-Jul | 14-Jul | | | Data replicated successfully | 5.4 |
| 5.6 | TC-06: Write to Replica (Negative) | Juan Akbar | | 14-Jul | 14-Jul | | | Read-only error returned | 5.5 |
| 5.7 | TC-07: Failover — Leader down (Positive) | Juan Akbar | | 14-Jul | 14-Jul | | | Failover successful | 5.6 |
| 5.8 | TC-08: Recovery — Leader back as Replica (Positive) | Juan Akbar | | 14-Jul | 14-Jul | | | Node D joined as Replica | 5.7 |
| 5.9 | TC-09: Manual switchover (Positive) | Juan Akbar | | 14-Jul | 14-Jul | | | Switchover successful | 5.8 |
| 5.10 | TC-10: HAProxy health check (Positive) | Juan Akbar | | 15-Jul | 15-Jul | | | Master 200, Replica 503 | 5.9 |
| 5.11 | TC-11: HAProxy wrong port (Negative) | Juan Akbar | | 15-Jul | 15-Jul | | | Connection timeout/rejected | 5.10 |
| 5.12 | TC-12: etcd quorum 1 node down (Positive) | Juan Akbar | | 15-Jul | 15-Jul | | | Cluster still healthy | 5.11 |
| 5.13 | TC-13: etcd quorum 2 nodes down (Negative) | Juan Akbar | | 15-Jul | 15-Jul | | | Cluster read-only | 5.12 |
| 5.14 | TC-14: etcd recovery from quorum loss (Positive) | Juan Akbar | | 15-Jul | 15-Jul | | | Quorum restored | 5.13 |
| 5.15 | TC-15: VIP movement — MASTER down (Positive) | Juan Akbar | | 15-Jul | 15-Jul | | | VIP moved to BACKUP | 5.14 |
| 5.16 | TC-16: VIP movement — MASTER back (Positive) | Juan Akbar | | 15-Jul | 15-Jul | | | VIP returned to MASTER | 5.15 |
| 5.17 | TC-17: Superuser postgres from network (Negative) | Juan Akbar | | 15-Jul | 15-Jul | | | Connection rejected | 5.16 |
| 5.18 | TC-18: Total recovery (all nodes down) (Positive) | Juan Akbar | | 15-Jul | 15-Jul | | | Cluster fully recovered | 5.17 |
| 5.19 | TC-19: Patroni REST API (Positive) | Juan Akbar | | 15-Jul | 15-Jul | | | All endpoints valid | 5.18 |
| 5.20 | TC-20: Backup & restore pgBackRest (Positive) | Juan Akbar | | 15-Jul | 15-Jul | | | Backup & restore OK | 5.19 |
| **M5** | **Milestone: All testing scenarios passed (20 TCs)** | | | **15-Jul** | **15-Jul** | | | **Testing OK** | |
| | **Phase 6 — Documentation & Handover** | | | **15-Jul** | **15-Jul** | | | | |
| 6.1 | Finalize configuration documentation | Juan Akbar | | 15-Jul | 15-Jul | | | Final config docs | 5.8 |
| 6.2 | Document backup strategy | Juan Akbar | | 15-Jul | 15-Jul | | | Backup procedure doc | 5.8 |
| 6.3 | Handover to operations team | Juan Akbar | | 15-Jul | 15-Jul | | | Handover signed off | 6.1–6.2 |
| **M6** | **Milestone: Project completed** | | | **15-Jul** | **15-Jul** | | | **Project closed** | |

---

## Summary Gantt Chart

```
July 2026 (Weekdays Only)
Task                | 02 | 03 | 06 | 07 | 08 | 09 | 10 | 13 | 14 | 15 |
--------------------|----|----|----|----|----|----|----|----|----|----|
Phase 1: Preparation| ██ | ██ |    |    |    |    |    |    |    |    |
Phase 2: etcd       |    |    | ██ | ██ | ██ |    |    |    |    |    |
Phase 3: Patroni    |    |    |    |    | ██ | ██ | ██ |    |    |    |
Phase 4: HA+Keepl   |    |    |    |    |    |    |    | ██ | ██ |    |
Phase 5: Testing    |    |    |    |    |    |    |    |    | ██ | ██ |
Phase 6: Docs       |    |    |    |    |    |    |    |    |    | ██ |
```

**Weekend (Skip):** 04-Jul (Sat), 05-Jul (Sun), 11-Jul (Sat), 12-Jul (Sun)

## Total Estimate: 10 working days (02 – 15 July 2026)
