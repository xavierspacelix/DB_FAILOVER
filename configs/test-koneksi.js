#!/usr/bin/env node
// Test koneksi database ke PG-HA Cluster
// Usage: node test-koneksi.js
// Install: npm install pg

const { Client } = require('pg');

const DB_CONFIG = {
  host: '10.30.110.112',
  port: 5432,
  user: 'groupware',
  password: 'KBBgroupware@2025!',
  database: 'kb_groupware',
};

async function testKoneksi(label, config) {
  const client = new Client(config);
  try {
    await client.connect();
    const res = await client.query('SELECT 1 AS test, pg_is_in_recovery(), version()');
    const row = res.rows[0];
    console.log(`  [OK] ${label}`);
    console.log(`       Test: ${row.test}`);
    console.log(`       Role: ${row.pg_is_in_recovery ? 'Replica' : 'LEADER'}`);
    console.log(`       Versi: ${row.version.split(',')[0]}`);
    await client.end();
    return true;
  } catch (e) {
    console.log(`  [FAIL] ${label}: ${e.message}`);
    return false;
  }
}

async function main() {
  console.log('=== TEST KONEKSI PG-HA CLUSTER ===\n');

  console.log('1. Via VIP (10.30.110.112):');
  await testKoneksi('VIP -> HAProxy -> Leader', DB_CONFIG);

  console.log('\n2. Direct ke Node D (Leader):');
  await testKoneksi('Node D', { ...DB_CONFIG, host: '10.30.110.128' });

  console.log('\n3. Direct ke Node E (Replica):');
  await testKoneksi('Node E', { ...DB_CONFIG, host: '10.30.110.113' });

  console.log('\n4. Test data:');
  try {
    const client = new Client(DB_CONFIG);
    await client.connect();
    const res = await client.query("SELECT count(*) as total FROM pg_database WHERE datname LIKE 'kb_%'");
    console.log(`  [OK] Database kb_* ditemukan: ${res.rows[0].total}`);
    await client.end();
  } catch (e) {
    console.log(`  [FAIL] ${e.message}`);
  }

  console.log('\n=== SELESAI ===');
}

main();
