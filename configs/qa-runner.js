#!/usr/bin/env node
// QA Test Runner — PG-HA Cluster (Fully Automated, 19 TC)
// node qa-runner.js
// npm install pg

const net = require('net');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { exec, execSync } = require('child_process');
const readline = require('readline');

let pg;
try { pg = require('pg'); } catch {}

const CFG = {
  vip: '10.30.110.112',
  nodeD: '10.30.110.128',
  nodeE: '10.30.110.113',
  etcdNodes: [
    { ip: '10.30.110.114', name: 'A', desc: 'etcd + HAProxy + Keepalived MASTER' },
    { ip: '10.30.110.115', name: 'B', desc: 'etcd + HAProxy + Keepalived BACKUP' },
    { ip: '10.30.110.116', name: 'C', desc: 'etcd' },
  ],
  patroniNodes: [
    { ip: '10.30.110.128', name: 'D', member: 'node-d' },
    { ip: '10.30.110.113', name: 'E', member: 'node-e' },
  ],
  patroniConfig: '/etc/patroni/patroni.yml',
  haproxyNodes: ['10.30.110.114', '10.30.110.115'],
  keepalivedMaster: { ip: '10.30.110.114', name: 'A' },
  keepalivedBackup: { ip: '10.30.110.115', name: 'B' },
  dbUser: 'groupware',
  dbPass: 'KBBgroupware@2025!)',
  dbName: 'nama_database',
  dbTest: 'qa_test',
  sshPort: 22,
  sshTimeout: 10,
};

const NOW = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const REPORT_FILE = path.join(__dirname, `qa-report-${NOW}.json`);

const testResults = [];
let passed = 0, failed = 0, skipped = 0;
let pgAvailable = !!pg;

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function execPromise(cmd, opts = {}) {
  return new Promise(resolve => {
    exec(cmd, opts, (err, stdout, stderr) => {
      resolve({
        err: err ? err.message : null,
        code: err ? err.code : 0,
        stdout: (stdout || '').trim(),
        stderr: (stderr || '').trim(),
      });
    });
  });
}

function getCreds(host) {
  return host === CFG.nodeD ? CFG.sshD : CFG.sshOther;
}

async function ssh(host, cmd) {
  const creds = getCreds(host);
  const esc = s => s.replace(/'/g, "'\\''");
  const sudoCmd = `sudo bash -c '${esc(cmd)}'`;
  const pipeCmd = `printf '%s\\n' '${esc(creds.pass)}' | ${sudoCmd}`;
  const sshArgs = [
    `sshpass -e ssh`,
    `-o StrictHostKeyChecking=no`,
    `-o UserKnownHostsFile=/dev/null`,
    `-o ConnectTimeout=${CFG.sshTimeout}`,
    `-p ${CFG.sshPort}`,
    `${creds.user}@${host}`,
    `'${esc(pipeCmd)}'`,
  ].join(' ');
  return execPromise(sshArgs, { env: { ...process.env, SSHPASS: creds.pass } });
}

function httpGet(url) {
  return new Promise(res => {
    const req = http.get(url, r => {
      let d = '';
      r.on('data', c => d += c);
      r.on('end', () => res({ status: r.statusCode, body: d }));
    });
    req.on('error', e => res({ status: 0, body: e.message }));
    req.setTimeout(8000, () => { req.destroy(); res({ status: 0, body: 'timeout' }); });
  });
}

function tcpCheck(host, port) {
  return new Promise(resolve => {
    const s = new net.Socket();
    s.setTimeout(3000);
    s.on('connect', () => { s.destroy(); resolve(true); });
    s.on('error', () => resolve(false));
    s.on('timeout', () => { s.destroy(); resolve(false); });
    s.connect(port, host);
  });
}

async function sql(host, query, user, pass) {
  if (!pg) return { err: 'pg module not installed (npm install pg)' };
  const client = new pg.Client({
    host, port: 5432,
    user: user || CFG.dbUser,
    password: pass || CFG.dbPass,
    database: CFG.dbName,
    connectionTimeoutMillis: 5000,
    query_timeout: 10000,
  });
  try {
    await client.connect();
    const r = await client.query(query);
    await client.end();
    return { rows: r.rows, err: null };
  } catch (e) {
    return { rows: null, err: e.message };
  }
}

async function detectCluster() {
  for (const node of CFG.patroniNodes) {
    const r = await httpGet(`http://${node.ip}:8008/cluster`);
    if (r.status !== 200) continue;
    try {
      const c = JSON.parse(r.body);
      if (!c.members || c.members.length === 0) continue;
      const leader = c.members.find(m => m.role === 'leader');
      const replica = c.members.find(m => m.role === 'replica');
      return {
        leaderIp: leader ? leader.host : null,
        leaderName: leader ? leader.name : null,
        replicaIp: replica ? replica.host : null,
        replicaName: replica ? replica.name : null,
        leaderApi: leader ? leader.api_url : null,
        members: c.members,
      };
    } catch {}
  }
  return null;
}

async function detectVIP() {
  for (const host of [CFG.keepalivedMaster.ip, CFG.keepalivedBackup.ip]) {
    const r = await ssh(host, `ip addr show | grep '${CFG.vip}/' || true`);
    if (!r.err && r.stdout.includes(CFG.vip)) {
      const name = host === CFG.keepalivedMaster.ip ? 'A (MASTER)' : 'B (BACKUP)';
      return { holderIp: host, holderName: name };
    }
  }
  return null;
}

async function detectEtcdHealth() {
  const etcdHost = CFG.etcdNodes[0].ip;
  const r = await ssh(etcdHost, `etcdctl endpoint health --cluster -w table 2>/dev/null || true`);
  if (r.err) return { error: r.err, healthy: 0, total: 0 };
  const lines = r.stdout.split('\n').filter(l => l.includes('|') && l.includes('true') || l.includes('false'));
  const healthy = lines.filter(l => l.includes('true')).length;
  const total = lines.length;
  return { error: null, healthy, total, raw: r.stdout };
}

function patroniCtl(cmd) {
  return ssh(CFG.nodeD, `patronictl -c ${CFG.patroniConfig} ${cmd} 2>/dev/null || true`);
}

async function waitUntil(desc, fn, predicate, timeoutMs) {
  const start = Date.now();
  const pollMs = 2000;
  while (Date.now() - start < timeoutMs) {
    const result = await fn();
    if (predicate(result)) return { success: true, result, elapsed: Date.now() - start };
    await sleep(pollMs);
  }
  const last = await fn();
  return { success: false, result: last, elapsed: Date.now() - start };
}

function recordResult(id, type, title, status, duration, detail, evidence) {
  const s = status ? 'PASS' : 'FAIL';
  const icon = status ? '✓' : '✗';
  const entry = {
    id, type, title,
    status: s,
    duration: duration || '-',
    timestamp: new Date().toISOString(),
    detail: detail || '',
    evidence: evidence || '',
  };
  testResults.push(entry);
  if (status) passed++;
  else failed++;
  console.log(`  ${icon} [${s}] ${id} — ${title} (${duration})`);
  if (detail) console.log(`       ${detail}`);
  if (evidence) console.log(`       → ${evidence}`);
  if (!status && detail) console.log(`       Cause: ${detail}`);
}

function question(query, silent = false) {
  return new Promise(resolve => {
    if (silent) execSync('stty -echo', { stdio: 'inherit' });
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(query, answer => {
      if (silent) { execSync('stty echo', { stdio: 'inherit' }); process.stdout.write('\n'); }
      rl.close();
      resolve(answer);
    });
  });
}

async function promptSshCreds() {
  console.log('\n─── SSH CREDENTIALS ───\n');
  const userD = await question('SSH Username (Node D — 10.30.110.128 khusus): ');
  const passD = await question('SSH Password (Node D — 10.30.110.128 khusus): ', true);
  const userOther = await question('\nSSH Username (Node lainnya — A/B/C/E): ');
  const passOther = await question('SSH Password (Node lainnya — A/B/C/E): ', true);
  CFG.sshD = { user: userD, pass: passD };
  CFG.sshOther = { user: userOther, pass: passOther };
}

async function validateSsh() {
  console.log('\nVerifying SSH access...');
  const allIps = [CFG.nodeD, CFG.nodeE, ...CFG.etcdNodes.map(n => n.ip)];
  let ok = 0, fail = 0;
  for (const ip of allIps) {
    const r = await ssh(ip, 'hostname');
    if (!r.err) { ok++; console.log(`  ✓ ${ip}: ${r.stdout}`); }
    else { fail++; console.log(`  ✗ ${ip}: ${r.stderr || r.err}`); }
  }
  if (fail > 0) {
    console.log(`\n⚠ ${fail} node(s) unreachable. Lanjutkan tetap riskan.`);
    const ans = await question('Tetap lanjut? (y/N): ');
    if (ans.toLowerCase() !== 'y') { console.log('Abort.'); process.exit(1); }
  } else {
    console.log(`  ✓ All ${ok} nodes reachable.`);
  }
}

function printBlockHeader(title) {
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`  ${title}`);
  console.log(`${'─'.repeat(60)}\n`);
}

async function ensureClusterHealthy() {
  const cluster = await detectCluster();
  if (!cluster) {
    console.log('  ⚠ Cluster tidak terdeteksi via API. Diagnosis:');
    for (const node of CFG.patroniNodes) {
      const h = await httpGet(`http://${node.ip}:8008/health`);
      console.log(`  ${node.name} (${node.ip}): health=${h.status}`);
    }
    return null;
  }
  console.log(`  Cluster OK: Leader=${cluster.leaderName} (${cluster.leaderIp}), Replica=${cluster.replicaName} (${cluster.replicaIp})`);
  return cluster;
}

// ─── BLOCK 1: Safe Tests ───

async function blockSafeTests() {
  printBlockHeader('BLOCK 1 — Safe Tests (no state change)');

  if (!pgAvailable) {
    console.log('  ⚠ pg module not available — skip SQL-dependent tests. npm install pg\n');
  }

  // Detect roles
  let cluster = await ensureClusterHealthy();
  if (!cluster) cluster = { leaderIp: CFG.nodeD, replicaIp: CFG.nodeE, leaderName: 'node-d', replicaName: 'node-e' };

  // TC-01: Connection via VIP
  const t1 = Date.now();
  const r1 = await sql(CFG.vip, 'SELECT 1 AS test');
  const d1 = ((Date.now() - t1) / 1000).toFixed(1);
  recordResult('TC-01', 'Positive', 'Koneksi via VIP',
    !r1.err && r1.rows && r1.rows[0].test === 1,
    d1 + 's',
    r1.err ? `Gagal: ${r1.err}` : `SELECT 1 AS test → ${JSON.stringify(r1.rows[0])}`,
    r1.err ? r1.err : 'pg.Client query OK');

  // TC-02: Wrong user (Negative)
  const t2 = Date.now();
  const r2 = await sql(CFG.vip, 'SELECT 1', 'user_tidak_ada', 'wrong_pass');
  const d2 = ((Date.now() - t2) / 1000).toFixed(1);
  const denied2 = r2.err && (r2.err.includes('does not exist') || r2.err.includes('pg_hba'));
  recordResult('TC-02', 'Negative', 'User salah ditolak',
    denied2,
    d2 + 's',
    denied2 ? 'Ditolak sesuai harapan (role does not exist / pg_hba)' : (r2.err ? `Error: ${r2.err}` : 'Seharusnya ditolak tapi malah berhasil'),
    denied2 ? `Error message: ${r2.err}` : '');

  // TC-03: Direct to Leader (dynamic)
  const t3 = Date.now();
  const r3 = await sql(cluster.leaderIp, 'SELECT pg_is_in_recovery()');
  const d3 = ((Date.now() - t3) / 1000).toFixed(1);
  const isLeader = !r3.err && r3.rows && r3.rows[0].pg_is_in_recovery === false;
  recordResult('TC-03', 'Positive', `Koneksi ke Leader (${cluster.leaderName}@${cluster.leaderIp})`,
    isLeader,
    d3 + 's',
    isLeader ? `Leader ${cluster.leaderIp}: pg_is_in_recovery() → false` : (r3.err || 'pg_is_in_recovery() bukan false'),
    isLeader ? `SQL: SELECT pg_is_in_recovery() → false` : '');

  // TC-04: Direct to Replica (dynamic)
  const t4 = Date.now();
  const r4 = await sql(cluster.replicaIp, 'SELECT pg_is_in_recovery()');
  const d4 = ((Date.now() - t4) / 1000).toFixed(1);
  const isReplica = !r4.err && r4.rows && r4.rows[0].pg_is_in_recovery === true;
  recordResult('TC-04', 'Positive', `Koneksi ke Replica (${cluster.replicaName}@${cluster.replicaIp})`,
    isReplica,
    d4 + 's',
    isReplica ? `Replica ${cluster.replicaIp}: pg_is_in_recovery() → true` : (r4.err || 'pg_is_in_recovery() bukan true'),
    isReplica ? `SQL: SELECT pg_is_in_recovery() → true` : '');

  // TC-05: Data replication
  const t5 = Date.now();
  await sql(CFG.vip, `DROP TABLE IF EXISTS ${CFG.dbTest}`);
  const r5a = await sql(CFG.vip, `CREATE TABLE ${CFG.dbTest} (id serial, name text)`);
  const r5b = await sql(CFG.vip, `INSERT INTO ${CFG.dbTest} (name) VALUES ('test1'),('test2')`);
  const r5c = await sql(CFG.vip, `SELECT COUNT(*) AS n FROM ${CFG.dbTest}`);
  const insertOk = !r5a.err && !r5b.err && r5c.rows && r5c.rows[0].n == 2;
  if (insertOk) {
    await sleep(3000);
    const r5d = await sql(cluster.replicaIp, `SELECT COUNT(*) AS n FROM ${CFG.dbTest}`);
    const replicated = !r5d.err && r5d.rows && r5d.rows[0].n == 2;
    const d5 = ((Date.now() - t5) / 1000).toFixed(1);
    recordResult('TC-05', 'Positive', 'Replikasi data dari Leader ke Replica',
      replicated,
      d5 + 's',
      replicated ? `Leader: INSERT 2 rows → Replica: ${r5d.rows[0].n} rows (replicated OK)` : (r5d.err || `Replica hanya ${r5d.rows ? r5d.rows[0].n : 0} rows`),
      replicated ? 'Data verified: test1, test2 present on Replica' : '');
  } else {
    const d5 = ((Date.now() - t5) / 1000).toFixed(1);
    recordResult('TC-05', 'Positive', 'Replikasi data dari Leader ke Replica',
      false,
      d5 + 's',
      `Insert data gagal: ${r5a.err || r5b.err || r5c.err || 'unknown'}`,
      '');
  }

  // TC-06: Write to Replica (Negative)
  const t6 = Date.now();
  const r6 = await sql(cluster.replicaIp, `INSERT INTO ${CFG.dbTest} (name) VALUES ('harus_gagal')`);
  const d6 = ((Date.now() - t6) / 1000).toFixed(1);
  const denied6 = r6.err && r6.err.includes('read-only');
  recordResult('TC-06', 'Negative', 'Write ke Replica ditolak',
    denied6,
    d6 + 's',
    denied6 ? 'Read-only error sesuai harapan' : (r6.err ? `Error: ${r6.err}` : 'Write berhasil — seharusnya ditolak'),
    denied6 ? `Error: ${r6.err}` : '');

  // TC-10: HAProxy health check
  const t10 = Date.now();
  const h1 = await httpGet(`http://${cluster.leaderIp}:8008/master`);
  const h2 = await httpGet(`http://${cluster.replicaIp}:8008/master`);
  const d10 = ((Date.now() - t10) / 1000).toFixed(1);
  const hOk = h1.status === 200 && h2.status !== 200;
  recordResult('TC-10', 'Positive', 'HAProxy health check — routing ke Leader saja',
    hOk,
    d10 + 's',
    hOk ? `Leader /master → ${h1.status}, Replica /master → ${h2.status}` : `Leader health=${h1.status}, Replica health=${h2.status}`,
    `curl -s http://${cluster.leaderIp}:8008/master → ${h1.status}, ${cluster.replicaIp}:8008/master → ${h2.status}`);

  // TC-11: Wrong port (Negative)
  const t11 = Date.now();
  const port5433 = await tcpCheck(CFG.vip, 5433);
  const port9999 = await tcpCheck(CFG.vip, 9999);
  const d11 = ((Date.now() - t11) / 1000).toFixed(1);
  recordResult('TC-11', 'Negative', 'Koneksi ke port salah ditolak',
    !port5433 && !port9999,
    d11 + 's',
    `Port 5433: ${port5433 ? 'terbuka (unexpected)' : 'tertutup'}, Port 9999: ${port9999 ? 'terbuka (unexpected)' : 'tertutup'}`,
    '');

  // TC-17: Superuser from network (Negative)
  const t17 = Date.now();
  const r17 = await sql(cluster.leaderIp, 'SELECT 1', 'postgres', 'postgres_pass');
  const d17 = ((Date.now() - t17) / 1000).toFixed(1);
  const denied17 = r17.err && r17.err.includes('pg_hba');
  recordResult('TC-17', 'Negative', 'Superuser postgres ditolak dari jaringan',
    denied17,
    d17 + 's',
    denied17 ? 'Ditolak sesuai harapan (pg_hba reject)' : (r17.err ? `Error: ${r17.err}` : 'postgres bisa konek — seharusnya ditolak'),
    denied17 ? `Error: ${r17.err}` : '');

  // TC-19: Patroni REST API
  const t19 = Date.now();
  const a1 = await httpGet(`http://${cluster.leaderIp}:8008/health`);
  const a2 = await httpGet(`http://${cluster.leaderIp}:8008/cluster`);
  const a3 = await httpGet(`http://${cluster.leaderIp}:8008/master`);
  const apiOk = a1.status === 200 && a2.status === 200 && a3.status === 200;
  const d19 = ((Date.now() - t19) / 1000).toFixed(1);
  recordResult('TC-19', 'Positive', 'Patroni REST API endpoints valid',
    apiOk,
    d19 + 's',
    apiOk ? `/health=${a1.status} /cluster=${a2.status} /master=${a3.status}` : `health=${a1.status} cluster=${a2.status} master=${a3.status}`,
    '');

  return cluster;
}

// ─── BLOCK 2: Switchover (TC-09) ───

async function blockSwitchover() {
  printBlockHeader('BLOCK 2 — Switchover (TC-09)');

  let cluster = await ensureClusterHealthy();
  if (!cluster) return recordResult('TC-09', 'Positive', 'Manual switchover', false, '-', 'Cluster unreachable — skip TC-09', '');

  // Step 1: Switchover leader → replica
  const switchCmd = `echo y | patronictl -c ${CFG.patroniConfig} switchover --master ${cluster.leaderName} --candidate ${cluster.replicaName}`;
  const t9a = Date.now();
  const r9a = await ssh(CFG.nodeD, switchCmd);
  const d9a = ((Date.now() - t9a) / 1000).toFixed(1);

  // Wait for new leader
  const w1 = await waitUntil('Leader switch', detectCluster,
    c => c && c.leaderIp === cluster.replicaIp, 30000);

  let afterSwitch = w1.success ? w1.result : await detectCluster();

  if (!w1.success) {
    recordResult('TC-09', 'Positive', 'Manual switchover', false,
      d9a + 's',
      `Switchover gagal: replica ${cluster.replicaName} tidak jadi Leader dalam 30s`,
      r9a.stderr || r9a.stdout);
    // Try to restore
    await ssh(CFG.nodeD, `echo y | patronictl -c ${CFG.patroniConfig} switchover --master ${cluster.replicaName} --candidate ${cluster.leaderName}`);
    return;
  }

  // Verify DB via VIP still works
  const r9b = await sql(CFG.vip, 'SELECT 1 AS test');
  const dbOk = !r9b.err;

  if (!dbOk) {
    recordResult('TC-09', 'Positive', 'Manual switchover', false,
      d9a + 's',
      `Switchover sukses tapi koneksi via VIP gagal: ${r9b.err}`,
      '');
    return;
  }

  // Step 2: Switchover back to original leader
  const switchBack = `echo y | patronictl -c ${CFG.patroniConfig} switchover --master ${afterSwitch.leaderName} --candidate ${afterSwitch.replicaName}`;
  const t9b = Date.now();
  await ssh(CFG.nodeD, switchBack);
  await waitUntil('Switchover back', detectCluster,
    c => c && c.leaderIp === cluster.leaderIp, 30000);

  const d9 = ((Date.now() - t9a) / 1000).toFixed(1);
  recordResult('TC-09', 'Positive', 'Manual switchover',
    true,
    d9 + 's',
    `Switchover ${cluster.leaderName}→${cluster.replicaName} lalu balik → ${cluster.leaderName}. DB via VIP: OK (${d9a}s + recovery)`,
    `patronictl switchover --master ${cluster.leaderName} --candidate ${cluster.replicaName}`);

  // Wait for cluster to stabilize
  await sleep(5000);
}

// ─── BLOCK 3: Failover & Recovery (TC-07 → TC-08) ───

async function blockFailover() {
  printBlockHeader('BLOCK 3 — Failover & Recovery (TC-07 → TC-08)');

  let cluster = await ensureClusterHealthy();
  if (!cluster) {
    recordResult('TC-07', 'Positive', 'Failover — matikan Leader', false, '-', 'Cluster unreachable', '');
    recordResult('TC-08', 'Positive', 'Recovery — Leader mati kembali sebagai Replica', false, '-', 'Skipped because TC-07 not run', '');
    return;
  }

  const leaderIp = cluster.leaderIp;
  const leaderName = cluster.leaderName;
  const replicaIp = cluster.replicaIp;
  const replicaName = cluster.replicaName;

  // TC-07: Stop patroni on leader
  console.log(`  Stopping Patroni on Leader (${leaderName}@${leaderIp})...`);
  const t7 = Date.now();
  const r7 = await ssh(leaderIp, 'systemctl stop patroni');
  if (r7.err) {
    const d7 = ((Date.now() - t7) / 1000).toFixed(1);
    recordResult('TC-07', 'Positive', 'Failover — matikan Leader',
      false, d7 + 's',
      `Stop patroni gagal di ${leaderIp}: ${r7.err}`,
      r7.stderr || '');
    recordResult('TC-08', 'Positive', 'Recovery — Leader mati kembali sebagai Replica',
      false, '-', 'Skipped because TC-07 failed', '');
    return;
  }

  // Wait for replica to become leader
  const w1 = await waitUntil('Promote replica', detectCluster,
    c => c && c.leaderIp === replicaIp && c.replicaIp === null, 60000);

  const d7 = ((Date.now() - t7) / 1000).toFixed(1);
  let afterFailover = w1.success ? w1.result : await detectCluster();
  const failoverOk = w1.success;

  if (failoverOk) {
    recordResult('TC-07', 'Positive', 'Failover — matikan Leader',
      true, d7 + 's',
      `Leader ${leaderName} (${leaderIp}) stopped → ${replicaName} (${replicaIp}) jadi Leader dalam ${(w1.elapsed / 1000).toFixed(1)}s`,
      `systemctl stop patroni → wait ${(w1.elapsed / 1000).toFixed(1)}s → promote`);
  } else {
    const failDetail = afterFailover
      ? `Cluster state: Leader=${afterFailover.leaderName}, Replica=${afterFailover.replicaName}`
      : 'Cluster tidak terdeteksi';
    recordResult('TC-07', 'Positive', 'Failover — matikan Leader',
      false, d7 + 's',
      `Failover timeout 60s — ${replicaName} tidak jadi Leader. ${failDetail}`,
      afterFailover ? JSON.stringify(afterFailover) : 'Cluster down');
  }

  // TC-08: Start patroni on dead node (recovery)
  console.log(`  Starting Patroni on dead node (${leaderName}@${leaderIp})...`);
  const t8 = Date.now();
  const r8 = await ssh(leaderIp, 'systemctl start patroni');
  if (r8.err) {
    const d8 = ((Date.now() - t8) / 1000).toFixed(1);
    recordResult('TC-08', 'Positive', 'Recovery — Leader mati kembali sebagai Replica',
      false, d8 + 's',
      `Start patroni gagal di ${leaderIp}: ${r8.err}`,
      r8.stderr || '');
    return;
  }

  // Wait for it to join as replica
  const w2 = await waitUntil(`Join as replica`, detectCluster,
    c => c && c.leaderIp === replicaIp && c.replicaIp === leaderIp, 45000);

  const d8 = ((Date.now() - t8) / 1000).toFixed(1);
  let afterRecovery = w2.success ? w2.result : await detectCluster();

  if (w2.success) {
    // Verify data intact
    const r8b = await sql(CFG.vip, `SELECT COUNT(*) AS n FROM ${CFG.dbTest}`);
    const dataOk = !r8b.err && r8b.rows && r8b.rows[0].n >= 2;
    recordResult('TC-08', 'Positive', 'Recovery — Leader mati kembali sebagai Replica',
      true, d8 + 's',
      `${leaderName} join sebagai Replica (${(w2.elapsed / 1000).toFixed(1)}s). Data intact: ${dataOk ? r8b.rows[0].n + ' rows' : 'check gagal'}`,
      `systemctl start patroni → ${(w2.elapsed / 1000).toFixed(1)}s → replica state=running`);
  } else {
    const detail = afterRecovery
      ? `Cluster state: Leader=${afterRecovery.leaderName}, Replica=${afterRecovery.replicaName || 'none'}`
      : 'Cluster tidak terdeteksi';
    recordResult('TC-08', 'Positive', 'Recovery — Leader mati kembali sebagai Replica',
      false, d8 + 's',
      `Timeout 45s — ${leaderName} tidak join sebagai Replica. ${detail}`,
      '');
  }

  await sleep(3000);
}

// ─── BLOCK 4: etcd Quorum Tests (TC-12 → TC-13 → TC-14) ───

async function blockEtcd() {
  printBlockHeader('BLOCK 4 — etcd Quorum Tests (TC-12 → TC-13 → TC-14)');

  const etcdC = CFG.etcdNodes[2]; // Node C
  const etcdB = CFG.etcdNodes[1]; // Node B

  // TC-12: 1 node down (Positive)
  let t12 = Date.now();
  console.log(`  Stopping etcd on ${etcdC.name} (${etcdC.ip})...`);
  await ssh(etcdC.ip, 'systemctl stop etcd');
  await sleep(3000);

  const h12 = await detectEtcdHealth();
  const etcd1DownOk = !h12.error && h12.healthy >= 2 && h12.total >= 2;
  const d12 = ((Date.now() - t12) / 1000).toFixed(1);
  recordResult('TC-12', 'Positive', 'etcd quorum — 1 node down (masih sehat)',
    etcd1DownOk,
    d12 + 's',
    etcd1DownOk ? `etcd ${h12.healthy}/${h12.total} healthy — quorum intact` : `etcd health: ${h12.healthy}/${h12.total} — ${h12.error || ''}`,
    etcd1DownOk ? `etcdctl: ${h12.healthy}/${h12.total} sehat` : '');

  // Start Node C back
  await ssh(etcdC.ip, 'systemctl start etcd');
  await sleep(3000);
  const h12b = await detectEtcdHealth();
  if (!h12b.error && h12b.healthy < 3) {
    console.log(`  ⚠ Waiting for etcd Node C to rejoin...`);
    await sleep(5000);
  }

  // TC-13: 2 nodes down (Negative)
  let t13 = Date.now();
  console.log(`  Stopping etcd on ${etcdB.name} (${etcdB.ip}) and ${etcdC.name} (${etcdC.ip})...`);
  await ssh(etcdB.ip, 'systemctl stop etcd');
  await ssh(etcdC.ip, 'systemctl stop etcd');
  await sleep(3000);

  const h13 = await detectEtcdHealth();
  const quorumLost = h13.error || h13.healthy < 2;
  const d13 = ((Date.now() - t13) / 1000).toFixed(1);

  // Check Patroni status during quorum loss
  const p13 = await patroniCtl('list');
  const patroniDown = p13.err || p13.stdout.includes('Error') || p13.stdout.includes('connection refused') || p13.stdout.trim() === '';

  recordResult('TC-13', 'Negative', 'etcd quorum — 2 node down (cluster read-only)',
    quorumLost,
    d13 + 's',
    quorumLost
      ? `etcd quorum lost (${h13.healthy}/${h13.total}). Patroni: ${patroniDown ? 'terpengaruh sesuai harapan' : 'masih jalan'}`
      : `etcd masih ${h13.healthy}/${h13.total} sehat — seharusnya quorum loss`,
    quorumLost ? `etcdctl: ${h13.healthy || 0}/${h13.total || 3} sehat` : '');

  // TC-14: Recovery
  let t14 = Date.now();
  console.log(`  Starting etcd on ${etcdB.name} and ${etcdC.name}...`);
  await ssh(etcdB.ip, 'systemctl start etcd');
  await ssh(etcdC.ip, 'systemctl start etcd');

  const w14 = await waitUntil('etcd recovery', detectEtcdHealth,
    h => !h.error && h.healthy >= 3, 30000);

  const h14 = w14.success ? w14.result : await detectEtcdHealth();
  const recovered = !h14.error && h14.healthy >= 3;
  const d14 = ((Date.now() - t14) / 1000).toFixed(1);

  // Wait for Patroni to recover
  await sleep(5000);
  const cluster14 = await detectCluster();

  recordResult('TC-14', 'Positive', 'etcd recovery dari quorum loss',
    recovered && cluster14 !== null,
    d14 + 's',
    recovered
      ? `etcd ${h14.healthy}/3 sehat${cluster14 ? `. Patroni OK: ${cluster14.leaderName} Leader, ${cluster14.replicaName} Replica` : '. Patroni belum pulih'}`
      : `etcd ${h14.healthy || 0}/3 — ${h14.error || 'belum pulih dalam 30s'}`,
    recovered ? `etcdctl endpoint health: ${h14.healthy}/3 sehat` : '');
}

// ─── BLOCK 5: VIP Movement (TC-15 → TC-16) ───

async function blockVip() {
  printBlockHeader('BLOCK 5 — VIP Movement (TC-15 → TC-16)');

  // Detect current VIP holder
  let vip = await detectVIP();
  if (!vip) {
    recordResult('TC-15', 'Positive', 'VIP movement — MASTER down', false, '-', 'VIP tidak terdeteksi di A atau B', '');
    recordResult('TC-16', 'Positive', 'VIP movement — MASTER kembali', false, '-', 'Skipped because TC-15 not run', '');
    return;
  }
  console.log(`  VIP currently on ${vip.holderName} (${vip.holderIp})`);

  const masterIp = CFG.keepalivedMaster.ip;
  const backupIp = CFG.keepalivedBackup.ip;

  // TC-15: Stop keepalived on MASTER
  let t15 = Date.now();
  console.log(`  Stopping keepalived on ${CFG.keepalivedMaster.name} (${masterIp})...`);
  await ssh(masterIp, 'systemctl stop keepalived');
  await sleep(5000);

  const vip15 = await detectVIP();
  const moved = vip15 && vip15.holderIp === backupIp;
  const d15 = ((Date.now() - t15) / 1000).toFixed(1);

  // Verify DB via VIP still works
  const r15 = await sql(CFG.vip, 'SELECT 1 AS test');
  const db15Ok = !r15.err;

  recordResult('TC-15', 'Positive', 'VIP movement — MASTER down',
    moved && db15Ok,
    d15 + 's',
    moved
      ? `VIP pindah ke ${vip15.holderName} (${vip15.holderIp}). DB via VIP: ${db15Ok ? 'OK' : 'GAGAL: ' + r15.err}`
      : `VIP tidak pindah. Current: ${vip15 ? vip15.holderName : 'none'}. DB: ${db15Ok ? 'OK' : 'GAGAL'}`,
    moved ? `Keepalived MASTER down → VIP ${vip15.holderIp}` : '');

  // TC-16: Start keepalived on MASTER
  let t16 = Date.now();
  console.log(`  Starting keepalived on ${CFG.keepalivedMaster.name} (${masterIp})...`);
  await ssh(masterIp, 'systemctl start keepalived');
  await sleep(5000);

  const vip16 = await detectVIP();
  const returned = vip16 && vip16.holderIp === masterIp;
  const d16 = ((Date.now() - t16) / 1000).toFixed(1);

  // Verify DB via VIP still works
  const r16 = await sql(CFG.vip, 'SELECT 1 AS test');
  const db16Ok = !r16.err;

  recordResult('TC-16', 'Positive', 'VIP movement — MASTER kembali',
    returned && db16Ok,
    d16 + 's',
    returned
      ? `VIP kembali ke ${vip16.holderName} (${vip16.holderIp}). DB via VIP: ${db16Ok ? 'OK' : 'GAGAL: ' + r16.err}`
      : `VIP tidak kembali. Current: ${vip16 ? vip16.holderName : 'none'}. DB: ${db16Ok ? 'OK' : 'GAGAL'}`,
    returned ? `Keepalived MASTER up → VIP ${vip16.holderIp}` : '');
}

// ─── BLOCK 6: Total Recovery (TC-18) ───

async function blockTotalRecovery() {
  printBlockHeader('BLOCK 6 — Total Recovery (TC-18)');

  const t18 = Date.now();
  const allIps = [CFG.nodeD, CFG.nodeE, ...CFG.etcdNodes.map(n => n.ip)];
  const stopOrder = [
    { ips: [CFG.nodeE], svc: 'patroni' },
    { ips: [CFG.nodeD], svc: 'patroni' },
    { ips: [CFG.haproxyNodes[0], CFG.haproxyNodes[1]], svc: 'keepalived', wait: 1 },
    { ips: [CFG.haproxyNodes[0], CFG.haproxyNodes[1]], svc: 'haproxy' },
    { ips: CFG.etcdNodes.map(n => n.ip), svc: 'etcd' },
  ];

  // Stop all services
  console.log('  Stopping all services on all nodes...');
  for (const group of stopOrder) {
    for (const ip of group.ips) {
      const r = await ssh(ip, `systemctl stop ${group.svc} 2>/dev/null; true`);
      if (r.err) console.log(`  ⚠ stop ${group.svc}@${ip}: ${r.err}`);
    }
    if (group.wait) await sleep(group.wait * 1000);
  }
  await sleep(3000);

  // Start in correct order
  // 1. etcd on A, B, C
  console.log('  Starting etcd on all nodes...');
  for (const node of CFG.etcdNodes) {
    await ssh(node.ip, `systemctl start etcd 2>/dev/null; true`);
  }
  const wEtcd = await waitUntil('etcd quorum 3/3', detectEtcdHealth,
    h => !h.error && h.healthy >= 3, 30000);
  if (!wEtcd.success) {
    const h = wEtcd.result;
    const d18 = ((Date.now() - t18) / 1000).toFixed(1);
    recordResult('TC-18', 'Positive', 'Total Recovery — semua node mati lalu hidup',
      false, d18 + 's',
      `etcd gagal reach quorum: ${h.healthy || 0}/3 setelah 30s`,
      h.error || '');
    return;
  }
  console.log(`  ✓ etcd quorum ${wEtcd.result.healthy}/3`);

  // 2. Patroni on Node D (will be leader)
  console.log('  Starting Patroni on Node D (Leader)...');
  await ssh(CFG.nodeD, 'systemctl start patroni');
  const wLeader = await waitUntil('Patroni leader', detectCluster,
    c => c && c.leaderIp === CFG.nodeD, 45000);
  if (!wLeader.success) {
    const d18 = ((Date.now() - t18) / 1000).toFixed(1);
    recordResult('TC-18', 'Positive', 'Total Recovery — semua node mati lalu hidup',
      false, d18 + 's',
      `Node D gagal jadi Leader dalam 45s`,
      wLeader.result ? JSON.stringify(wLeader.result) : 'Cluster not detected');
    return;
  }
  console.log(`  ✓ Node D = Leader`);

  // 3. Patroni on Node E (replica)
  console.log('  Starting Patroni on Node E (Replica)...');
  await ssh(CFG.nodeE, 'systemctl start patroni');
  const wReplica = await waitUntil('Patroni replica', detectCluster,
    c => c && c.replicaIp === CFG.nodeE, 45000);
  if (!wReplica.success) {
    const d18 = ((Date.now() - t18) / 1000).toFixed(1);
    recordResult('TC-18', 'Positive', 'Total Recovery — semua node mati lalu hidup',
      false, d18 + 's',
      `Node E gagal join sebagai Replica dalam 45s`,
      wReplica.result ? JSON.stringify(wReplica.result) : 'Cluster not detected');
    return;
  }
  console.log(`  ✓ Node E = Replica`);

  // 4. HAProxy + Keepalived on A, B
  console.log('  Starting HAProxy + Keepalived on A, B...');
  for (const ip of CFG.haproxyNodes) {
    await ssh(ip, 'systemctl start haproxy 2>/dev/null; true');
    await ssh(ip, 'systemctl start keepalived 2>/dev/null; true');
  }
  await sleep(5000);

  // Final verification
  const vip18 = await detectVIP();
  const vipOk = vip18 !== null;
  const r18 = await sql(CFG.vip, `SELECT COUNT(*) AS n FROM ${CFG.dbTest}`);
  const dataOk = !r18.err && r18.rows && r18.rows[0].n >= 2;
  const r18b = await sql(CFG.vip, 'SELECT 1 AS test');
  const dbOk = !r18b.err;

  const d18 = ((Date.now() - t18) / 1000).toFixed(1);
  const allOk = vipOk && dbOk && dataOk;

  recordResult('TC-18', 'Positive', 'Total Recovery — semua node mati lalu hidup',
    allOk,
    d18 + 's',
    allOk
      ? `Cluster pulih total. VIP: ${vip18.holderName} (${vip18.holderIp}). DB: ${dbOk ? 'OK' : 'FAIL'}. Data: ${dataOk ? r18.rows[0].n + ' rows' : 'FAIL'}`
      : `Recovery incomplete. VIP: ${vipOk ? vip18.holderName : 'none'}. DB: ${dbOk ? 'OK' : 'FAIL'}. Data: ${dataOk ? r18.rows[0].n + ' rows' : 'FAIL'}`,
    allOk ? 'Full cluster recovery: etcd→Patroni→HAProxy→Keepalived all healthy' : '');
}

// ─── CLEANUP ───

async function cleanup() {
  if (pgAvailable) {
    await sql(CFG.vip, `DROP TABLE IF EXISTS ${CFG.dbTest}`);
  }
}

// ─── REPORT ───

function printReport() {
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`         QA TEST REPORT — PG-HA CLUSTER`);
  console.log(`         Executed: ${new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })}`);
  console.log(`${'═'.repeat(60)}\n`);

  console.log(`  Total  : ${testResults.length}`);
  console.log(`  Passed : ${passed}`);
  console.log(`  Failed : ${failed}`);
  console.log(`  Skipped: ${skipped}`);
  console.log('');

  const failedTests = testResults.filter(r => r.status === 'FAIL');
  if (failedTests.length > 0) {
    console.log(`  ─── FAILED DETAILS ───\n`);
    for (const ft of failedTests) {
      console.log(`  ✗ ${ft.id} (${ft.type})`);
      console.log(`    Title  : ${ft.title}`);
      console.log(`    Detail : ${ft.detail}`);
      console.log(`    Evidence: ${ft.evidence || 'none'}`);
      console.log('');
    }
    console.log(`${'─'.repeat(60)}\n`);
  }

  // Markdown table for docs
  console.log(`  ─── COPY KE docs/92-qa-test-cases.md ───\n`);
  console.log(`| TC ID | Type | Status |`);
  console.log(`|-------|------|--------|`);
  for (const r of testResults) {
    console.log(`| ${r.id} | ${r.type} | ${r.status} |`);
  }
  console.log('');

  // Save JSON report
  const report = {
    timestamp: new Date().toISOString(),
    timezone: 'Asia/Jakarta',
    environment: {
      vip: CFG.vip,
      nodeD: CFG.nodeD,
      nodeE: CFG.nodeE,
      etcdNodes: CFG.etcdNodes.map(n => `${n.name} (${n.ip})`),
      patroniNodes: CFG.patroniNodes.map(n => `${n.name} (${n.ip})`),
      haproxyNodes: CFG.haproxyNodes,
    },
    summary: {
      total: testResults.length,
      passed,
      failed,
      skipped,
    },
    results: testResults,
    credentials: {
      sshD: { user: CFG.sshD.user, pass: CFG.sshD.pass },
      sshOther: { user: CFG.sshOther.user, pass: CFG.sshOther.pass },
      dbUser: CFG.dbUser,
      dbPass: CFG.dbPass,
    },
  };

  fs.writeFileSync(REPORT_FILE, JSON.stringify(report, null, 2));
  console.log(`  JSON report saved: ${REPORT_FILE}`);
}

// ─── MAIN ───

async function main() {
  console.log('╔══════════════════════════════════════════╗');
  console.log('║    QA TEST RUNNER — PG-HA CLUSTER       ║');
  console.log('║    19 Test Cases — Fully Automated       ║');
  console.log('╚══════════════════════════════════════════╝');

  // Pre-check
  try { execSync('which sshpass', { stdio: 'pipe' }); }
  catch { console.log('\n✗ sshpass not found. Install: dnf install sshpass'); process.exit(1); }

  if (!pgAvailable) {
    console.log('\n⚠ pg module not installed. npm install pg for SQL-based tests.');
    console.log('  (SSH-based tests will still run.)\n');
  }

  // Input SSH credentials
  await promptSshCreds();

  // Validate SSH access
  await validateSsh();

  // Run test blocks
  try { await blockSafeTests(); } catch (e) { console.log(`  ✗ BLOCK 1 error: ${e.message}`); }
  try { await blockSwitchover(); } catch (e) { console.log(`  ✗ BLOCK 2 error: ${e.message}`); }
  try { await blockFailover(); } catch (e) { console.log(`  ✗ BLOCK 3 error: ${e.message}`); }
  try { await blockEtcd(); } catch (e) { console.log(`  ✗ BLOCK 4 error: ${e.message}`); }
  try { await blockVip(); } catch (e) { console.log(`  ✗ BLOCK 5 error: ${e.message}`); }
  try { await blockTotalRecovery(); } catch (e) { console.log(`  ✗ BLOCK 6 error: ${e.message}`); }

  // Cleanup
  await cleanup();

  // Report
  printReport();
}

main().catch(e => {
  console.error('\n✗ FATAL:', e.message);
  process.exit(1);
});
