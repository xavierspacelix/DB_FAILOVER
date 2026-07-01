# User Management

## User untuk Koneksi Aplikasi

Gunakan `groupware` — jangan pakai `postgres`.

**DB_URL:**

```
postgresql://groupware:KBBgroupware@2025!@10.30.110.112:5432/nama_database
```

## Cara Buat Database untuk Aplikasi

```bash
# SSH ke Node D atau E
psql -h 127.0.0.1 -U postgres -c "CREATE DATABASE nama_database OWNER groupware;"
```

## Daftar User Internal

| User | Password | Fungsi |
|------|----------|--------|
| `postgres` | `postgres_pass` | Admin — hanya dari localhost |
| `replicator` | `replicator_pass` | Replikasi streaming |
| `groupware` | `KBBgroupware@2025!` | **Koneksi aplikasi** |
