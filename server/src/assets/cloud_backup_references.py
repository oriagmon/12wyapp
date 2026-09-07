"""Bounded stdlib-only evidence metadata reader for an immutable completed SQLite copy."""
import json
import os
import re
import resource
import sqlite3
import stat
import sys
import time
import urllib.parse

MAX_ROWS = 10000
MAX_SOURCE = 1024 * 1024 * 1024
MAX_OUTPUT = 4 * 1024 * 1024
NAME = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]{0,199}")


def require(value):
    if not value:
        raise ValueError("invalid snapshot references")


def fingerprint(info):
    return info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns, info.st_ctime_ns


def read_references(filename):
    require(sys.version_info >= (3, 8) and sqlite3.sqlite_version_info >= (3, 31, 0))
    require(os.path.isabs(filename) and os.path.realpath(filename) == filename
            and re.fullmatch(r"app-\d{8}T\d{6}Z\.sqlite", os.path.basename(filename))
            and re.fullmatch(r"cloud-run-\d{8}T\d{6}Z-\d+", os.path.basename(os.path.dirname(filename))))
    parent = os.lstat(os.path.dirname(filename))
    require(stat.S_ISDIR(parent.st_mode) and parent.st_uid == os.getuid() and not parent.st_mode & 0o022)
    fd = os.open(filename, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        before = os.fstat(fd)
        require(stat.S_ISREG(before.st_mode) and before.st_nlink == 1 and before.st_uid == os.getuid()
                and not before.st_mode & 0o022 and 0 < before.st_size <= MAX_SOURCE)
        # Set SQLite's global heap ceiling before opening/parsing the untrusted file schema.
        control = sqlite3.connect(":memory:")
        try:
            limit = control.execute("PRAGMA hard_heap_limit=67108864").fetchone()[0]
            require(isinstance(limit, int) and 0 < limit <= 67108864)
        finally:
            control.close()
        resource.setrlimit(resource.RLIMIT_CPU, (10, 10))
        if sys.platform.startswith("linux"):
            resource.setrlimit(resource.RLIMIT_AS, (256 * 1024 * 1024, 256 * 1024 * 1024))
        deadline = time.monotonic() + 10
        uri = "file:" + urllib.parse.quote(filename, safe="/") + "?mode=ro&immutable=1"
        connection = sqlite3.connect(uri, uri=True, timeout=1)
        try:
            # Fresh SQLite connections disable extension loading by default. Some OS
            # Python builds omit the enabling API entirely; never enable it in either case.
            if hasattr(connection, "enable_load_extension"):
                connection.enable_load_extension(False)
            connection.execute("PRAGMA query_only=ON")
            connection.execute("PRAGMA trusted_schema=OFF")
            connection.execute("PRAGMA temp_store=MEMORY")
            connection.execute("PRAGMA cache_size=-4096")
            # Newer Python exposes an additional per-value ceiling. The global heap cap
            # above applies on the supported older Python versions too.
            if hasattr(connection, "setlimit"):
                connection.setlimit(sqlite3.SQLITE_LIMIT_LENGTH, 1024 * 1024)
                connection.setlimit(sqlite3.SQLITE_LIMIT_SQL_LENGTH, 65536)
            connection.set_progress_handler(lambda: 1 if time.monotonic() >= deadline else 0, 1000)
            schema = connection.execute("""SELECT CASE WHEN type='table'
              AND upper(ltrim(substr(sql,1,64))) LIKE 'CREATE TABLE %'
              THEN 1 ELSE 0 END FROM sqlite_master WHERE name='tactic_evidence' LIMIT 2""").fetchall()
            require(schema == [] or schema == [(1,)])
            references = []
            if schema:
                # Never return raw unbounded TEXT/BLOB values. Type checks reject blobs;
                # a 201-BYTE prefix preserves NUL/non-ASCII/oversize evidence of malformed
                # TEXT, unlike SQLite TEXT length/substr which can hide a NUL suffix.
                query = """SELECT
                  CASE WHEN typeof(file_stored_name)='text'
                    THEN hex(substr(CAST(file_stored_name AS BLOB),1,201)) END,
                  CASE WHEN typeof(file_size)='integer' AND file_size BETWEEN 0 AND 1073741824
                    THEN file_size END
                  FROM tactic_evidence WHERE file_stored_name IS NOT NULL LIMIT 10001"""
                for encoded_name, byte_count in connection.execute(query):
                    require(len(references) < MAX_ROWS and isinstance(encoded_name, str) and len(encoded_name) <= 402
                            and isinstance(byte_count, int) and 0 <= byte_count <= MAX_SOURCE)
                    name = bytes.fromhex(encoded_name).decode("ascii", "strict")
                    require(NAME.fullmatch(name))
                    references.append({"name": name, "bytes": byte_count})
            require(time.monotonic() < deadline and fingerprint(before) == fingerprint(os.fstat(fd))
                    and fingerprint(before) == fingerprint(os.lstat(filename)))
            return references
        finally:
            connection.close()
    finally:
        os.close(fd)


def main():
    require(len(sys.argv) == 2)
    references = read_references(sys.argv[1])
    output = json.dumps({"version": 1, "references": references}, separators=(",", ":"), ensure_ascii=True).encode("ascii")
    require(len(output) + 1 <= MAX_OUTPUT)
    sys.stdout.buffer.write(output + b"\n")


if __name__ == "__main__":
    try:
        main()
    except Exception:
        print("SNAPSHOT_REFERENCES_INVALID", file=sys.stderr)
        sys.exit(1)
