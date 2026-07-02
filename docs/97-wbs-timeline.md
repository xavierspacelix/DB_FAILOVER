# WBS Timeline — PG-HA Cluster Deployment

**Start Date:** 02-July-2026  
**Target OS:** RHEL / Rocky Linux 9.x  
**Project Lead:** Juan Akbar

---

| WBS NUMBER | TASK TITLE | PIC | TASK OWNER | Timeline Awal | | Actual Timeline | | DELIVERABLE | DEPENDENCY |
|---|---|---|---|---|---|---|---|---|---|
| | | | | START DATE | DUE DATE | ACTUAL START | ACTUAL DUE | | |
| | **Phase 1 — Preparation** | | | **02-Jul** | **04-Jul** | | | | |
| 1.1 | Setup builder + enable EPEL & PGDG repo | Juan Akbar | | 02-Jul | 02-Jul | | | Builder environment ready | - |
| 1.2 | Install createrepo_c | Juan Akbar | | 02-Jul | 02-Jul | | | createrepo_c installed | 1.1 |
| 1.3 | Verify package availability | Juan Akbar | | 02-Jul | 02-Jul | | | Package list confirmed | 1.2 |
| 1.4 | Download all RPMs (274 packages) | Juan Akbar | | 03-Jul | 03-Jul | | | 274 RPMs downloaded | 1.1–1.3 |
| 1.5 | Build local repo (createrepo_c) | Juan Akbar | | 04-Jul | 04-Jul | | | Local repo (repodata) | 1.4 |
| 1.6 | Package bundle (pgha-offline-bundle.tar.gz) | Juan Akbar | | 04-Jul | 04-Jul | | | offline bundle 134MB | 1.5 |
| 1.7 | Test offline install on builder VM | Juan Akbar | | 04-Jul | 04-Jul | | | Install test passed | 1.6 |
| **M1** | **Milestone: Bundle RPM ready for deployment** | | | **04-Jul** | **04-Jul** | | | **Bundle approved** | |
| | **Phase 2 — Deploy etcd Cluster** | | | **05-Jul** | **07-Jul** | | | | |
| 2.1 | Transfer bundle to Node A/B/C (.114/.115/.116) | Juan Akbar | | 05-Jul | 05-Jul | | | Bundle delivered to nodes | 1.7 |
| 2.2 | Setup local repo on Node A, B, C | Juan Akbar | | 05-Jul | 05-Jul | | | local-offline.repo configured | 2.1 |
| 2.3 | Install etcd on Node A, B, C | Juan Akbar | | 06-Jul | 06-Jul | | | etcd installed on 3 nodes | 2.2 |
| 2.4 | Configure etcd (update conf per node) | Juan Akbar | | 06-Jul | 06-Jul | | | etcd.conf per node | 2.3 |
| 2.5 | Start etcd cluster (A+B+C simultaneously) | Juan Akbar | | 07-Jul | 07-Jul | | | etcd cluster running | 2.4 |
| 2.6 | Verify etcd quorum (3/3 healthy) | Juan Akbar | | 07-Jul | 07-Jul | | | Quorum achieved | 2.5 |
| **M2** | **Milestone: etcd 3-node cluster quorum achieved** | | | **07-Jul** | **07-Jul** | | | **etcd OK** | |
| | **Phase 3 — Deploy Patroni + PostgreSQL** | | | **07-Jul** | **09-Jul** | | | | |
| 3.1 | Transfer bundle + repo to Node D (.128) | Juan Akbar | | 07-Jul | 07-Jul | | | Bundle delivered to .128 | 2.6 |
| 3.2 | Verify existing PostgreSQL parameters on .128 | Juan Akbar | | 07-Jul | 07-Jul | | | Config check report | - |
| 3.3 | Install patroni + patroni-etcd on Node D | Juan Akbar | | 08-Jul | 08-Jul | | | Patroni installed on .128 | 3.1 |
| 3.4 | Configure Patroni Node D (existing data) | Juan Akbar | | 08-Jul | 08-Jul | | | patroni.yml for existing DB | 3.2–3.3 |
| 3.5 | Stop old PostgreSQL, start Patroni on Node D | Juan Akbar | | 08-Jul | 08-Jul | | | Patroni running as Leader | 3.4 |
| 3.6 | Verify Node D as Leader + data intact | Juan Akbar | | 08-Jul | 08-Jul | | | Data verified intact | 3.5 |
| 3.7 | Transfer bundle + repo to Node E (.113) | Juan Akbar | | 09-Jul | 09-Jul | | | Bundle delivered to .113 | 3.6 |
| 3.8 | Install patroni + patroni-etcd on Node E | Juan Akbar | | 09-Jul | 09-Jul | | | Patroni installed on .113 | 3.7 |
| 3.9 | Configure Patroni Node E (Replica) | Juan Akbar | | 09-Jul | 09-Jul | | | patroni.yml for Replica | 3.8 |
| 3.10 | Start Patroni on Node E (auto-join as Replica) | Juan Akbar | | 09-Jul | 09-Jul | | | Node E joined as Replica | 3.9 |
| 3.11 | Verify streaming replication (Leader → Replica) | Juan Akbar | | 09-Jul | 09-Jul | | | Replication confirmed | 3.10 |
| **M3** | **Milestone: Patroni cluster + replication running** | | | **09-Jul** | **09-Jul** | | | **Patroni OK** | |
| | **Phase 4 — Deploy HAProxy + Keepalived** | | | **10-Jul** | **11-Jul** | | | | |
| 4.1 | Transfer bundle + repo to Node A (.114) & B (.115) | Juan Akbar | | 10-Jul | 10-Jul | | | Bundle on .114 & .115 | 3.11 |
| 4.2 | Install haproxy + keepalived on Node A & B | Juan Akbar | | 10-Jul | 10-Jul | | | Packages installed | 4.1 |
| 4.3 | Configure HAProxy (same on Node A & B) | Juan Akbar | | 10-Jul | 10-Jul | | | haproxy.cfg deployed | 4.2 |
| 4.4 | Start HAProxy on Node A & B | Juan Akbar | | 10-Jul | 10-Jul | | | HAProxy running | 4.3 |
| 4.5 | Configure Keepalived MASTER on Node A | Juan Akbar | | 11-Jul | 11-Jul | | | keepalived-master.conf | 4.4 |
| 4.6 | Configure Keepalived BACKUP on Node B | Juan Akbar | | 11-Jul | 11-Jul | | | keepalived-backup.conf | 4.4 |
| 4.7 | Start Keepalived on Node A & B | Juan Akbar | | 11-Jul | 11-Jul | | | Keepalived running | 4.5–4.6 |
| 4.8 | Verify VIP 10.30.110.112 active on MASTER | Juan Akbar | | 11-Jul | 11-Jul | | | VIP confirmed active | 4.7 |
| **M4** | **Milestone: HAProxy + Keepalived + VIP operational** | | | **11-Jul** | **11-Jul** | | | **Network HA OK** | |
| | **Phase 5 — Testing** | | | **12-Jul** | **14-Jul** | | | | |
| 5.1 | Test connection via VIP (psql -h 10.30.110.112) | Juan Akbar | | 12-Jul | 12-Jul | | | Connection test passed | 4.8 |
| 5.2 | Test data replication (create table, verify on Replica) | Juan Akbar | | 12-Jul | 12-Jul | | | Replication verified | 5.1 |
| 5.3 | Test failover (kill Node D, Node E becomes Leader) | Juan Akbar | | 12-Jul | 12-Jul | | | Failover successful | 5.2 |
| 5.4 | Test switchover (manual Leader transfer) | Juan Akbar | | 12-Jul | 12-Jul | | | Switchover successful | 5.3 |
| 5.5 | Test HAProxy health check (routing to /master) | Juan Akbar | | 13-Jul | 13-Jul | | | Health check passed | 5.4 |
| 5.6 | Test etcd quorum tolerance (1 node down) | Juan Akbar | | 13-Jul | 13-Jul | | | Quorum tolerance OK | 5.5 |
| 5.7 | Test VIP movement (kill MASTER) | Juan Akbar | | 13-Jul | 13-Jul | | | VIP movement passed | 5.5 |
| 5.8 | Test total recovery (all nodes down → up) | Juan Akbar | | 14-Jul | 14-Jul | | | Total recovery passed | 5.6–5.7 |
| **M5** | **Milestone: All testing scenarios passed** | | | **14-Jul** | **14-Jul** | | | **Testing OK** | |
| | **Phase 6 — Documentation & Handover** | | | **14-Jul** | **15-Jul** | | | | |
| 6.1 | Finalize configuration documentation | Juan Akbar | | 14-Jul | 15-Jul | | | Final config docs | 5.8 |
| 6.2 | Document backup strategy | Juan Akbar | | 14-Jul | 15-Jul | | | Backup procedure doc | 5.8 |
| 6.3 | Handover to operations team | Juan Akbar | | 15-Jul | 15-Jul | | | Handover signed off | 6.1–6.2 |
| **M6** | **Milestone: Project completed** | | | **15-Jul** | **15-Jul** | | | **Project closed** | |

---

## Summary Gantt Chart

```
July 2026
Task                | 02 | 03 | 04 | 05 | 06 | 07 | 08 | 09 | 10 | 11 | 12 | 13 | 14 | 15 |
--------------------|----|----|----|----|----|----|----|----|----|----|----|----|----|----|
Phase 1: Preparation| ██ | ██ | ██ |    |    |    |    |    |    |    |    |    |    |    |
Phase 2: etcd       |    |    |    | ██ | ██ | ██ |    |    |    |    |    |    |    |    |
Phase 3: Patroni    |    |    |    |    |    | ██ | ██ | ██ |    |    |    |    |    |    |
Phase 4: HA+Keepl   |    |    |    |    |    |    |    |    | ██ | ██ |    |    |    |    |
Phase 5: Testing    |    |    |    |    |    |    |    |    |    |    | ██ | ██ | ██ |    |
Phase 6: Docs       |    |    |    |    |    |    |    |    |    |    |    |    | ██ | ██ |
```

## Total Estimate: 14 Days (10 working days)
