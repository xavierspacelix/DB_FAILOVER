#!/usr/bin/env python3
# Test koneksi database ke PG-HA Cluster
# Usage: python3 test-koneksi.py

import psycopg2

DB_CONFIG = {
    "host": "10.30.110.112",
    "port": 5432,
    "user": "groupware",
    "password": "KBBgroupware@2025!",
    "dbname": "kb_groupware",
}

def test_koneksi(label, config):
    try:
        conn = psycopg2.connect(**config)
        cur = conn.cursor()
        cur.execute("SELECT 1 AS test, pg_is_in_recovery(), version()")
        row = cur.fetchone()
        print(f"  [OK] {label}")
        print(f"       Test: {row[0]}")
        print(f"       Role: {'Replica' if row[1] else 'LEADER'}")
        print(f"       Versi: {row[2].split(',')[0]}")
        cur.close()
        conn.close()
        return True
    except Exception as e:
        print(f"  [FAIL] {label}: {e}")
        return False

def main():
    print("=== TEST KONEKSI PG-HA CLUSTER ===\n")

    # 1. Via VIP
    print("1. Via VIP (10.30.110.112):")
    test_koneksi("VIP -> HAProxy -> Leader", DB_CONFIG)

    # 2. Direct ke Node D
    cfg_d = dict(DB_CONFIG, host="10.30.110.128")
    print("\n2. Direct ke Node D (Leader):")
    test_koneksi("Node D", cfg_d)

    # 3. Direct ke Node E
    cfg_e = dict(DB_CONFIG, host="10.30.110.113")
    print("\n3. Direct ke Node E (Replica):")
    test_koneksi("Node E", cfg_e)

    # 4. Test data
    print("\n4. Test data:")
    try:
        conn = psycopg2.connect(**DB_CONFIG)
        cur = conn.cursor()
        cur.execute("SELECT count(*) FROM pg_database WHERE datname LIKE 'kb_%'")
        total = cur.fetchone()[0]
        print(f"  [OK] Database kb_* ditemukan: {total}")
        cur.close()
        conn.close()
    except Exception as e:
        print(f"  [FAIL] {e}")

    print("\n=== SELESAI ===")

if __name__ == "__main__":
    main()
