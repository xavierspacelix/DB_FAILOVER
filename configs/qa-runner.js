#!/usr/bin/env node
// QA Test Runner — PG-HA Cluster
// node qa-runner.js
// npm install pg

const net = require('net');
const http = require('http');
const { execSync } = require('child_process');

let pg;
try { pg = require('pg'); } catch { }

const CFG = {
  vip: '10.30.110.112',
  nodeD: '10.30.110.128',
  nodeE: '10.30.110.113',
  etcd1: '10.30.110.114',
  user: 'groupware',
  pass: 'KBBgroupware@2025!',
  db: 'kb_groupware',
  dbTest: 'qa_test',
};

const RESULTS = [];
let passed = 0, failed = 0, skipped = 0;

function httpGet(url) {
  return new Promise(res => {
    const req = http.get(url, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => res({ status: r.statusCode, body: d })); });
    req.on('error', e => res({ status: 0, body: e.message }));
    req.setTimeout(5000, () => { req.destroy(); res({ status: 0, body: 'timeout' }); });
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
  const client = new pg.Client({ host, port: 5432, user: user || CFG.user, password: pass || CFG.pass, database: CFG.db });
  try {
    await client.connect();
    const r = await client.query(query);
    await client.end();
    return { rows: r.rows, err: null };
  } catch (e) {
    return { rows: null, err: e.message };
  }
}

function result(id, type, title, status, detail) {
  const s = status ? 'PASS' : 'FAIL';
  RESULTS.push({ id, type, title, status: s, detail });
  if (status) passed++; else failed++;
  const icon = status ? '✓' : '✗';
  console.log(`  ${icon} [${s}] ${id} - ${title}`);
  if (detail) console.log(`       ${detail}`);
}

function manual(id, type, title) {
  RESULTS.push({ id, type, title, status: 'SKIP', detail: 'Manual test' });
  skipped++;
  console.log(`  - [SKIP] ${id} - ${title} (manual)`);
}

async function main() {
  console.log('╔══════════════════════════════════════╗');
  console.log('║   QA TEST RUNNER — PG-HA CLUSTER    ║');
  console.log('╚══════════════════════════════════════╝\n');

  // ─── POSITIVE TESTS ───

  console.log('\n─── POSITIVE TEST CASES ───\n');

  // TC-01: Connection via VIP
  console.log('TC-01: Koneksi database via VIP...');
  const r1 = await sql(CFG.vip, 'SELECT 1 AS test');
  result('TC-01', 'Positive', 'Koneksi via VIP', !r1.err, r1.err || 'SELECT 1 OK');

  // TC-03: Direct to Leader
  console.log('TC-03: Koneksi langsung ke Leader...');
  const r3 = await sql(CFG.nodeD, 'SELECT pg_is_in_recovery()');
  const isLeader = r3.rows && r3.rows[0].pg_is_in_recovery === false;
  result('TC-03', 'Positive', 'Koneksi ke Leader', isLeader, r3.err || (isLeader ? 'Leader OK' : 'Bukan Leader'));

  // TC-04: Direct to Replica
  console.log('TC-04: Koneksi langsung ke Replica...');
  const r4 = await sql(CFG.nodeE, 'SELECT pg_is_in_recovery()');
  const isReplica = r4.rows && r4.rows[0].pg_is_in_recovery === true;
  result('TC-04', 'Positive', 'Koneksi ke Replica', isReplica, r4.err || (isReplica ? 'Replica OK' : 'Bukan Replica'));

  // TC-05: Data replication
  console.log('TC-05: Replikasi data...');
  const r5a = await sql(CFG.vip, `DROP TABLE IF EXISTS qa_test CASCADE; CREATE TABLE qa_test (id serial, name text); INSERT INTO qa_test (name) VALUES ('test1'),('test2'); SELECT COUNT(*) AS n FROM qa_test`);
  const insertOk = r5a.rows && r5a.rows[0] && r5a.rows[0].n == 2;
  if (insertOk) {
    await new Promise(r => setTimeout(r, 2000)); // wait for replication
    const r5b = await sql(CFG.nodeE, 'SELECT COUNT(*) AS n FROM qa_test');
    const replicated = r5b.rows && r5b.rows[0].n == 2;
    result('TC-05', 'Positive', 'Replikasi data', replicated, replicated ? 'Data tereplikasi (2 rows)' : (r5b.err || 'Data tidak tereplikasi'));
  } else {
    result('TC-05', 'Positive', 'Replikasi data', false, r5a.err || 'Insert gagal');
  }

  // TC-10: HAProxy health check
  console.log('TC-10: HAProxy health check...');
  const h1 = await httpGet(`http://${CFG.nodeD}:8008/master`);
  const h2 = await httpGet(`http://${CFG.nodeE}:8008/master`);
  const hOk = h1.status === 200 && h2.status !== 200;
  result('TC-10', 'Positive', 'HAProxy health check', hOk, `Leader:${h1.status} Replica:${h2.status}`);

  // TC-12: etcd quorum 1 node down (check only, actual test is manual)
  console.log('TC-12: etcd quorum (check via API)...');
  const h3 = await httpGet(`http://${CFG.etcd1}:2379/version`);
  result('TC-12', 'Positive', 'etcd reachable', h3.status === 200, h3.status === 200 ? 'etcd OK' : 'etcd tidak reachable');

  // TC-19: Patroni REST API
  console.log('TC-19: Patroni REST API...');
  const a1 = await httpGet(`http://${CFG.nodeD}:8008/health`);
  const a2 = await httpGet(`http://${CFG.nodeD}:8008/cluster`);
  const a3 = await httpGet(`http://${CFG.nodeD}:8008/master`);
  const apiOk = a1.status === 200 && a3.status === 200;
  result('TC-19', 'Positive', 'Patroni API', apiOk, `health:${a1.status} cluster:${a2.status} master:${a3.status}`);

  // ─── NEGATIVE TESTS ───

  console.log('\n─── NEGATIVE TEST CASES ───\n');

  // TC-02: Wrong user
  console.log('TC-02: Koneksi dengan user salah...');
  const r2 = await sql(CFG.vip, 'SELECT 1', 'user_tidak_ada', 'wrong_pass');
  const denied2 = r2.err && r2.err.includes('does not exist');
  result('TC-02', 'Negative', 'User salah ditolak', denied2, denied2 ? 'Ditolak sesuai harapan' : (r2.err || 'Seharusnya ditolak'));

  // TC-06: Write to Replica
  console.log('TC-06: Write ke Replica...');
  const r6 = await sql(CFG.nodeE, 'INSERT INTO qa_test (name) VALUES (\'harus_gagal\')');
  const denied6 = r6.err && r6.err.includes('read-only');
  result('TC-06', 'Negative', 'Write ke Replica ditolak', denied6, denied6 ? 'Read-only error sesuai harapan' : (r6.err || 'Seharusnya ditolak'));

  // TC-11: Wrong port
  console.log('TC-11: Port salah...');
  const port5433 = await tcpCheck(CFG.vip, 5433);
  const port9999 = await tcpCheck(CFG.vip, 9999);
  result('TC-11', 'Negative', 'Port salah ditolak', !port5433 && !port9999, `5433:${port5433 ? 'terbuka' : 'tertutup'} 9999:${port9999 ? 'terbuka' : 'tertutup'}`);

  // TC-17: Superuser dari jaringan
  console.log('TC-17: Superuser dari jaringan...');
  const r17 = await sql(CFG.nodeD, 'SELECT 1', 'postgres', 'postgres_pass');
  const denied17 = r17.err && r17.err.includes('pg_hba');
  result('TC-17', 'Negative', 'Superuser ditolak dari jaringan', denied17, denied17 ? 'Ditolak sesuai harapan' : (r17.err || 'Seharusnya ditolak'));

  // ─── MANUAL TESTS ───

  console.log('\n─── MANUAL TEST CASES (jalankan terpisah) ───\n');

  manual('TC-07', 'Positive', 'Failover — matikan Leader, Replica jadi Leader');
  manual('TC-08', 'Positive', 'Recovery — Leader mati kembali sebagai Replica');
  manual('TC-09', 'Positive', 'Switchover manual');
  manual('TC-13', 'Negative', 'etcd quorum — 2 node down');
  manual('TC-14', 'Positive', 'etcd recovery dari quorum loss');
  manual('TC-15', 'Positive', 'VIP movement — MASTER down');
  manual('TC-16', 'Positive', 'VIP movement — MASTER kembali');
  manual('TC-18', 'Positive', 'Total recovery — semua node mati lalu hidup');
  manual('TC-20', 'Positive', 'Backup & restore pgBackRest');

  // ─── CLEANUP ───
  await sql(CFG.vip, 'DROP TABLE IF EXISTS qa_test');

  // ─── REPORT ───
  console.log('\n╔══════════════════════════════════════╗');
  console.log('║            TEST REPORT              ║');
  console.log('╚══════════════════════════════════════╝\n');
  console.log(`  Total : ${RESULTS.length}`);
  console.log(`  Passed: ${passed}`);
  console.log(`  Failed: ${failed}`);
  console.log(`  Skipped: ${skipped}`);
  console.log('');

  if (failed > 0) {
    console.log('  FAILED DETAILS:');
    RESULTS.filter(r => r.status === 'FAIL').forEach(r => {
      console.log(`  ✗ ${r.id}: ${r.detail}`);
    });
    console.log('');
  }

  // Print markdown table for docs
  console.log('  --- COPY INI KE docs/92-qa-test-cases.md ---\n');
  RESULTS.forEach(r => {
    console.log(`| ${r.id} | ${r.type} | ${r.status} |`);
  });
}

main().catch(e => console.error(e));
