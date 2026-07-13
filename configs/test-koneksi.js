#!/usr/bin/env node
// Test koneksi PG-HA Cluster
// node test-koneksi.js
// npm install pg  (untuk SQL test)

const net = require('net');

const TESTS = [
  { label: 'VIP (HAProxy)',   host: '10.30.110.112' },
  { label: 'Node D (Leader)', host: '10.30.110.128' },
  { label: 'Node E (Replica)',host: '10.30.110.113' },
];

function testTCP(host, port) {
  return new Promise(resolve => {
    const s = new net.Socket();
    s.setTimeout(3000);
    s.on('connect', () => { s.destroy(); resolve(true); });
    s.on('error', () => resolve(false));
    s.on('timeout', () => { s.destroy(); resolve(false); });
    s.connect(port, host);
  });
}

async function testSQL(host) {
  let pg;
  try { pg = require('pg'); } catch { return 'skip'; }
  const client = new pg.Client({ host, port: 5432, user: 'groupware', password: 'KBBgroupware@2025!', database: 'kb_groupware' });
  try {
    await client.connect();
    const r = (await client.query("SELECT 1, pg_is_in_recovery(), version()")).rows[0];
    await client.end();
    return `OK | Role: ${r.pg_is_in_recovery ? 'Replica' : 'LEADER'} | ${r.version.split(',')[0]}`;
  } catch (e) {
    return `FAIL - ${e.message}`;
  }
}

async function main() {
  console.log('=== TEST KONEKSI PG-HA CLUSTER ===\n');

  for (const t of TESTS) {
    const tcp = await testTCP(t.host, 5432);
    const tcpStr = tcp ? 'OK' : 'FAIL';
    console.log(`${t.label} (${t.host}:5432) TCP:${tcpStr}`);

    if (tcp) {
      const sql = await testSQL(t.host);
      if (sql !== 'skip') console.log(`       SQL: ${sql}`);
      else console.log(`       SQL: skip (npm install pg)`);
    }
    console.log('');
  }

  console.log('=== SELESAI ===');
}

main();
