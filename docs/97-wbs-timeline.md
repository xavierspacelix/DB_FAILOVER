# WBS Timeline — PG-HA Cluster Deployment

**Start Date:** 02-July-2026  
**Target OS:** RHEL / Rocky Linux 9.x  

---

## Phase 1 — Preparation (02–04 July)

| ID | Task | Duration | Start | End | Dep |
|----|------|----------|-------|-----|-----|
| 1.1 | Setup builder + enable EPEL & PGDG repo | 0.5 day | 02-Jul | 02-Jul | - |
| 1.2 | Install createrepo_c | 0.5 day | 02-Jul | 02-Jul | - |
| 1.3 | Verify package availability | 0.5 day | 02-Jul | 02-Jul | - |
| 1.4 | Download all RPMs (274 packages) | 1 day | 03-Jul | 03-Jul | 1.1–1.3 |
| 1.5 | Build local repo (createrepo_c) | 0.5 day | 04-Jul | 04-Jul | 1.4 |
| 1.6 | Package bundle (`pgha-offline-bundle.tar.gz`) | 0.5 day | 04-Jul | 04-Jul | 1.5 |
| 1.7 | Test offline install on builder VM | 0.5 day | 04-Jul | 04-Jul | 1.6 |

**Milestone 1:** ✅ Bundle RPM ready for deployment

---

## Phase 2 — Deploy etcd Cluster (05–07 July)

| ID | Task | Duration | Start | End | Dep |
|----|------|----------|-------|-----|-----|
| 2.1 | Transfer bundle to Node A (.114), B (.115), C (.116) | 0.5 day | 05-Jul | 05-Jul | 1.7 |
| 2.2 | Setup local repo on Node A, B, C | 0.5 day | 05-Jul | 05-Jul | 2.1 |
| 2.3 | Install etcd on Node A, B, C | 0.5 day | 06-Jul | 06-Jul | 2.2 |
| 2.4 | Configure etcd (update conf per node) | 0.5 day | 06-Jul | 06-Jul | 2.3 |
| 2.5 | Start etcd cluster (A+B+C simultaneously) | 0.5 day | 07-Jul | 07-Jul | 2.4 |
| 2.6 | Verify etcd quorum (3/3 healthy) | 0.5 day | 07-Jul | 07-Jul | 2.5 |

**Milestone 2:** ✅ etcd 3-node cluster quorum achieved

---

## Phase 3 — Deploy Patroni + PostgreSQL (07–09 July)

| ID | Task | Duration | Start | End | Dep |
|----|------|----------|-------|-----|-----|
| 3.1 | Transfer bundle + repo to Node D (.128) | 0.5 day | 07-Jul | 07-Jul | 2.6 |
| 3.2 | Verify existing PostgreSQL parameters on .128 | 0.5 day | 07-Jul | 07-Jul | - |
| 3.3 | Install patroni + patroni-etcd on Node D | 0.5 day | 08-Jul | 08-Jul | 3.1 |
| 3.4 | Configure Patroni Node D (existing data) | 0.5 day | 08-Jul | 08-Jul | 3.2–3.3 |
| 3.5 | Stop old PostgreSQL, start Patroni on Node D | 0.5 day | 08-Jul | 08-Jul | 3.4 |
| 3.6 | Verify Node D as Leader + data intact | 0.5 day | 08-Jul | 08-Jul | 3.5 |
| 3.7 | Transfer bundle + repo to Node E (.113) | 0.5 day | 09-Jul | 09-Jul | 3.6 |
| 3.8 | Install patroni + patroni-etcd on Node E | 0.5 day | 09-Jul | 09-Jul | 3.7 |
| 3.9 | Configure Patroni Node E (Replica) | 0.5 day | 09-Jul | 09-Jul | 3.8 |
| 3.10 | Start Patroni on Node E (auto-join as Replica) | 0.5 day | 09-Jul | 09-Jul | 3.9 |
| 3.11 | Verify streaming replication (Leader → Replica) | 0.5 day | 09-Jul | 09-Jul | 3.10 |

**Milestone 3:** ✅ Patroni 2-node cluster, streaming replication running

---

## Phase 4 — Deploy HAProxy + Keepalived (10–11 July)

| ID | Task | Duration | Start | End | Dep |
|----|------|----------|-------|-----|-----|
| 4.1 | Transfer bundle + repo to Node A (.114) & B (.115) | 0.5 day | 10-Jul | 10-Jul | 3.11 |
| 4.2 | Install haproxy + keepalived on Node A & B | 0.5 day | 10-Jul | 10-Jul | 4.1 |
| 4.3 | Configure HAProxy (same on Node A & B) | 0.5 day | 10-Jul | 10-Jul | 4.2 |
| 4.4 | Start HAProxy on Node A & B | 0.5 day | 10-Jul | 10-Jul | 4.3 |
| 4.5 | Configure Keepalived MASTER on Node A | 0.5 day | 11-Jul | 11-Jul | 4.4 |
| 4.6 | Configure Keepalived BACKUP on Node B | 0.5 day | 11-Jul | 11-Jul | 4.4 |
| 4.7 | Start Keepalived on Node A & B | 0.5 day | 11-Jul | 11-Jul | 4.5–4.6 |
| 4.8 | Verify VIP 10.30.110.112 active on MASTER | 0.5 day | 11-Jul | 11-Jul | 4.7 |

**Milestone 4:** ✅ HAProxy + Keepalived + VIP operational

---

## Phase 5 — Testing (12–14 July)

| ID | Task | Duration | Start | End | Dep |
|----|------|----------|-------|-----|-----|
| 5.1 | Test connection via VIP (`psql -h 10.30.110.112`) | 0.5 day | 12-Jul | 12-Jul | 4.8 |
| 5.2 | Test data replication (create table, verify on Replica) | 0.5 day | 12-Jul | 12-Jul | 5.1 |
| 5.3 | Test failover (kill Node D, Node E becomes Leader) | 0.5 day | 12-Jul | 12-Jul | 5.2 |
| 5.4 | Test switchover (manual Leader transfer) | 0.5 day | 12-Jul | 12-Jul | 5.3 |
| 5.5 | Test HAProxy health check (routing to /master) | 0.5 day | 13-Jul | 13-Jul | 5.4 |
| 5.6 | Test etcd quorum tolerance (1 node down) | 0.5 day | 13-Jul | 13-Jul | 5.5 |
| 5.7 | Test VIP movement (kill MASTER) | 0.5 day | 13-Jul | 13-Jul | 5.5 |
| 5.8 | Test total recovery (all nodes down → up) | 1 day | 14-Jul | 14-Jul | 5.6–5.7 |

**Milestone 5:** ✅ All testing scenarios passed

---

## Phase 6 — Documentation & Handover (14–15 July)

| ID | Task | Duration | Start | End | Dep |
|----|------|----------|-------|-----|-----|
| 6.1 | Finalize configuration documentation | 0.5 day | 14-Jul | 14-Jul | 5.8 |
| 6.2 | Document backup strategy | 0.5 day | 14-Jul | 14-Jul | 5.8 |
| 6.3 | Handover to operations team | 0.5 day | 15-Jul | 15-Jul | 6.1–6.2 |

**Milestone 6:** ✅ Project completed

---

## Summary Gantt Chart

```
July 2026
Task                | 02 | 03 | 04 | 05 | 06 | 07 | 08 | 09 | 10 | 11 | 12 | 13 | 14 | 15 |
--------------------|----|----|----|----|----|----|----|----|----|----|----|----|----|----|
Phase 1: Prep       | ██ | ██ | ██ |    |    |    |    |    |    |    |    |    |    |    |
Phase 2: etcd       |    |    |    | ██ | ██ | ██ |    |    |    |    |    |    |    |    |
Phase 3: Patroni    |    |    |    |    |    | ██ | ██ | ██ |    |    |    |    |    |    |
Phase 4: HA+Keepl   |    |    |    |    |    |    |    |    | ██ | ██ |    |    |    |    |
Phase 5: Testing    |    |    |    |    |    |    |    |    |    |    | ██ | ██ | ██ |    |
Phase 6: Docs       |    |    |    |    |    |    |    |    |    |    |    |    | ██ | ██ |
```

## Total Estimate: 14 Days (10 working days)
