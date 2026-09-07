"""Privileged coordinator; live SQLite is opened only by a jailed, permanently dropped worker."""
import errno
import fcntl
import os
import re
import resource
import signal
import sqlite3
import stat
import sys
import time
import urllib.parse
import uuid

MAX_BYTES = 1024 * 1024 * 1024
MAX_REFERENCES = 10000
CHUNK = 1024 * 1024
NAME = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]{0,199}")
DIR_FLAGS = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC
READ_FLAGS = os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK | os.O_CLOEXEC
PRIVATE_DB = ".database.sqlite"


class BackupFailure(Exception):
    pass


def require(condition):
    if not condition:
        raise BackupFailure()


def identity(info):
    return info.st_dev, info.st_ino, info.st_uid, info.st_gid, stat.S_IMODE(info.st_mode)


def stable(info):
    return identity(info), info.st_nlink, info.st_size, info.st_mtime_ns, info.st_ctime_ns


def regular(info, owner, maximum=MAX_BYTES):
    require(stat.S_ISREG(info.st_mode) and info.st_nlink == 1 and info.st_uid == owner
            and not info.st_mode & 0o022 and 0 <= info.st_size <= maximum)


class Directory:
    """Every component is opened relative to its retained, no-follow parent descriptor."""
    def __init__(self, filename, owners, create=False):
        require(isinstance(filename, str) and "\0" not in filename and "\\" not in filename
                and not any(ord(character) < 32 or ord(character) == 127 for character in filename))
        raw = filename if os.path.isabs(filename) else os.getcwd() + "/" + filename
        parts = raw.split("/")
        require(".." not in parts)
        self.path = "/" + "/".join(part for part in parts if part not in ("", "."))
        self.owners = set(owners)
        self.fds = []
        self.links = []
        try:
            self.fds.append(os.open("/", DIR_FLAGS))
            self.check_info(os.fstat(self.fds[0]))
            for name in self.path.split("/")[1:]:
                if not name:
                    continue
                parent = self.fds[-1]
                if create:
                    try:
                        os.mkdir(name, 0o750, dir_fd=parent)
                    except FileExistsError:
                        pass
                child = os.open(name, DIR_FLAGS, dir_fd=parent)
                self.fds.append(child)
                info = os.fstat(child)
                self.check_info(info)
                self.links.append((parent, name, child, identity(info)))
            self.fd = self.fds[-1]
            self.verify()
        except BaseException:
            self.close()
            raise

    def check_info(self, info):
        require(stat.S_ISDIR(info.st_mode) and info.st_uid in self.owners and not info.st_mode & 0o022)

    def verify(self):
        for parent, name, child, expected in self.links:
            current = os.stat(name, dir_fd=parent, follow_symlinks=False)
            self.check_info(current)
            require(identity(current) == expected == identity(os.fstat(child)))

    def close(self):
        for fd in reversed(self.fds):
            os.close(fd)
        self.fds = []


def sqlite_bounds():
    require(sqlite3.sqlite_version_info >= (3, 31, 0))
    control = sqlite3.connect(":memory:")
    try:
        value = control.execute("PRAGMA hard_heap_limit=67108864").fetchone()[0]
        require(isinstance(value, int) and 0 < value <= 67108864)
    finally:
        control.close()


def local_primary_gid(uid):
    # No NSS/LDAP calls: privilege dropping uses only the trusted local account database.
    directory = Directory("/etc", {0})
    try:
        fd = os.open("passwd", READ_FLAGS, dir_fd=directory.fd)
        try:
            regular(os.fstat(fd), 0, 65536)
            content = os.read(fd, 65537)
            require(len(content) <= 65536)
            matches = [line.split(":") for line in content.decode("utf-8").splitlines()
                       if len(line.split(":")) == 7 and line.split(":")[2] == str(uid)]
            require(len(matches) == 1 and matches[0][3].isdigit() and int(matches[0][3]) > 0)
            return int(matches[0][3])
        finally:
            os.close(fd)
    finally:
        directory.close()


def configure(connection):
    if hasattr(connection, "enable_load_extension"):
        connection.enable_load_extension(False)
    connection.execute("PRAGMA trusted_schema=OFF")
    connection.execute("PRAGMA temp_store=MEMORY")
    connection.execute("PRAGMA cache_size=-4096")
    connection.execute("PRAGMA mmap_size=0")


def source_entries(directory_fd, filename, owner):
    result = {}
    for suffix in ("", "-wal", "-shm", "-journal"):
        name = filename + suffix
        try:
            info = os.stat(name, dir_fd=directory_fd, follow_symlinks=False)
        except FileNotFoundError:
            require(suffix != "")
            continue
        regular(info, owner)
        require(suffix != "" or info.st_size > 0)
        result[name] = identity(info)
    return result


def verify_dropped(status_fd, uid, gid):
    require(os.getresuid() == (uid, uid, uid) and os.getresgid() == (gid, gid, gid) and os.getgroups() == [])
    raw = os.read(status_fd, 16385)
    require(len(raw) <= 16384)
    fields = dict(line.split(":", 1) for line in raw.decode("ascii").splitlines() if ":" in line)
    require(all(int(fields[name].strip(), 16) == 0 for name in ("CapEff", "CapPrm", "CapAmb")))


def verify_worker_handles(anchor, status_fd, destination):
    expected = os.stat(destination, follow_symlinks=False)
    regular(expected, 0)
    private_handles = 0
    descriptors = os.listdir("/proc/self/fd")
    require(len(descriptors) <= 1024)
    for value in descriptors:
        require(value.isdigit())
        fd = int(value)
        try:
            info = os.fstat(fd)
        except OSError as error:
            require(error.errno == errno.EBADF)
            continue
        if fd in (0, 1, 2):
            require(stat.S_ISCHR(info.st_mode))
        elif fd == anchor:
            require(stat.S_ISDIR(info.st_mode))
        elif fd == status_fd:
            require(stat.S_ISREG(info.st_mode))
        else:
            # Fail on a VFS retaining ANY additional directory/file capability. Never
            # close or repurpose SQLite-internal FDs, or assume their numeric identities.
            regular(info, 0)
            require((info.st_dev, info.st_ino) == (expected.st_dev, expected.st_ino))
            require(fcntl.fcntl(fd, fcntl.F_GETFL) & os.O_ACCMODE == os.O_RDWR)
            private_handles += 1
    require(private_handles > 0)


def live_worker(data, destination, filename, uid, gid):
    """The only retained out-of-jail capability is the newly created blank destination DB."""
    require(sys.platform.startswith("linux") and os.geteuid() == 0 and uid > 0 and gid > 0)
    resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
    resource.setrlimit(resource.RLIMIT_FSIZE, (MAX_BYTES, MAX_BYTES))
    resource.setrlimit(resource.RLIMIT_AS, (256 * 1024 * 1024, 256 * 1024 * 1024))
    signal.alarm(90)
    # Close ALL inherited capabilities, including caller-supplied directory FDs. This
    # happens before opening SQLite, so there is no guess about SQLite's internal FDs.
    anchor = fcntl.fcntl(data.fd, fcntl.F_DUPFD_CLOEXEC, 3)
    descriptors = os.listdir("/proc/self/fd")
    require(len(descriptors) <= 1024)
    for value in descriptors:
        require(value.isdigit())
        fd = int(value)
        if fd != anchor:
            try:
                os.close(fd)
            except OSError as error:
                require(error.errno == errno.EBADF)
    null_fd = os.open("/dev/null", os.O_RDWR | os.O_CLOEXEC)
    for fd in (0, 1, 2):
        os.dup2(null_fd, fd)
    if null_fd > 2:
        os.close(null_fd)
    sqlite_bounds()
    # Destination ancestors are protected and coordinator-owned. No source SQLite handle
    # exists before chroot + credential drop; no SQLite connection crosses fork().
    target = sqlite3.connect(destination, isolation_level=None, timeout=1)
    configure(target)
    require(target.execute("PRAGMA journal_mode=MEMORY").fetchone()[0] == "memory")
    target.execute("PRAGMA locking_mode=EXCLUSIVE")
    target.execute("PRAGMA synchronous=FULL")
    # Force initialization and retain the exclusive destination handle before chroot.
    target.execute("PRAGMA user_version=0")
    status_fd = os.open("/proc/self/status", os.O_RDONLY | os.O_CLOEXEC)
    uri = "file:/" + urllib.parse.quote(filename, safe="") + "?mode=ro"
    b"".decode("ascii")
    verify_worker_handles(anchor, status_fd, destination)
    os.fchdir(anchor)
    os.chroot(".")
    os.chdir("/")
    os.close(anchor)
    os.setgroups([])
    os.setresgid(gid, gid, gid)
    os.setresuid(uid, uid, uid)
    verify_dropped(status_fd, uid, gid)
    os.close(status_fd)
    root_fd = os.open("/", DIR_FLAGS)
    try:
        before = source_entries(root_fd, filename, uid)
        deadline = time.monotonic() + 75
        source = sqlite3.connect(uri, uri=True, isolation_level=None, timeout=1)
        try:
            configure(source)
            source.execute("PRAGMA query_only=ON")
            page_size = source.execute("PRAGMA page_size").fetchone()[0]
            require(isinstance(page_size, int) and 512 <= page_size <= 65536)

            def progress(_status, _remaining, total):
                require(time.monotonic() < deadline and 0 <= total * page_size <= MAX_BYTES)

            # Normal online backup, NOT immutable or raw-copy: committed WAL pages count.
            source.backup(target, pages=256, progress=progress, sleep=0.05)
        finally:
            source.close()
        after = source_entries(root_fd, filename, uid)
        require(before[filename] == after[filename])
        for name in set(before) & set(after):
            require(before[name] == after[name])
        target.close()
    finally:
        os.close(root_fd)
    # Initial/final shape checks alone are not the race boundary: even a transient DB,
    # WAL, SHM or journal swap is confined inside the jail with zero root credentials.


def snapshot_database(data, stage, filename, uid, gid):
    destination = stage.path + "/" + PRIVATE_DB
    fd = os.open(PRIVATE_DB, os.O_RDWR | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW | os.O_CLOEXEC,
                 0o600, dir_fd=stage.fd)
    os.close(fd)
    pid = os.fork()
    if pid == 0:
        try:
            live_worker(data, destination, filename, uid, gid)
            os._exit(0)
        except BaseException:
            os._exit(1)
    finished = False
    try:
        deadline = time.monotonic() + 95
        while True:
            waited, status = os.waitpid(pid, os.WNOHANG)
            if waited:
                finished = True
                require(os.WIFEXITED(status) and os.WEXITSTATUS(status) == 0)
                break
            require(time.monotonic() < deadline)
            time.sleep(0.05)
    finally:
        if not finished:
            try:
                os.kill(pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            os.waitpid(pid, 0)
    data.verify()
    stage.verify()
    require(os.listdir(stage.fd) == [PRIVATE_DB])
    fd = os.open(PRIVATE_DB, READ_FLAGS, dir_fd=stage.fd)
    try:
        info = os.fstat(fd)
        regular(info, os.geteuid())
        require(info.st_size > 0)
        os.fsync(fd)
        return info.st_size
    finally:
        os.close(fd)


def snapshot_references(filename):
    sqlite_bounds()
    uri = "file:" + urllib.parse.quote(filename, safe="/") + "?mode=ro&immutable=1"
    connection = sqlite3.connect(uri, uri=True, isolation_level=None, timeout=1)
    try:
        configure(connection)
        connection.execute("PRAGMA query_only=ON")
        if hasattr(connection, "setlimit"):
            connection.setlimit(sqlite3.SQLITE_LIMIT_LENGTH, 1024 * 1024)
            connection.setlimit(sqlite3.SQLITE_LIMIT_SQL_LENGTH, 65536)
        deadline = time.monotonic() + 15
        connection.set_progress_handler(lambda: int(time.monotonic() > deadline), 1000)
        require(connection.execute("PRAGMA quick_check(1)").fetchall() == [("ok",)])
        schema = connection.execute("""SELECT CASE WHEN type='table'
          AND upper(ltrim(substr(sql,1,64))) LIKE 'CREATE TABLE %' THEN 1 ELSE 0 END
          FROM sqlite_master WHERE name='tactic_evidence' LIMIT 2""").fetchall()
        require(schema in ([], [(1,)]))
        references = {}
        if schema:
            rows = connection.execute("""SELECT
              CASE WHEN typeof(file_stored_name)='text'
                THEN hex(substr(CAST(file_stored_name AS BLOB),1,201)) END,
              CASE WHEN typeof(file_size)='integer' AND file_size BETWEEN 0 AND 1073741824
                THEN file_size END
              FROM tactic_evidence WHERE file_stored_name IS NOT NULL LIMIT 10001""")
            for index, (encoded, size) in enumerate(rows):
                require(index < MAX_REFERENCES and isinstance(encoded, str) and len(encoded) <= 402
                        and isinstance(size, int) and 0 <= size <= MAX_BYTES)
                name = bytes.fromhex(encoded).decode("ascii", "strict")
                require(NAME.fullmatch(name) and (name not in references or references[name] == size))
                references[name] = size
        require(time.monotonic() <= deadline)
        return references
    finally:
        connection.close()


def copy_evidence(source, destination_fd, name, size, uid, gid):
    require(NAME.fullmatch(name) and isinstance(size, int) and 0 <= size <= MAX_BYTES)
    source.verify()
    fd = None
    for attempt in range(3):
        try:
            before_path = os.stat(name, dir_fd=source.fd, follow_symlinks=False)
            regular(before_path, uid)
            fd = os.open(name, READ_FLAGS, dir_fd=source.fd)
            break
        except FileNotFoundError:
            if attempt == 2:
                raise BackupFailure() from None
            time.sleep(0.2)
    require(fd is not None)
    try:
        before = os.fstat(fd)
        regular(before, uid)
        require(stable(before_path) == stable(before) and before.st_size == size)
        output = os.open(name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW | os.O_CLOEXEC,
                         0o640, dir_fd=destination_fd)
        try:
            os.fchown(output, os.geteuid(), gid)
            remaining = size
            while remaining:
                block = os.read(fd, min(CHUNK, remaining))
                require(bool(block))
                offset = 0
                while offset < len(block):
                    written = os.write(output, block[offset:])
                    require(written > 0)
                    offset += written
                remaining -= len(block)
            require(os.read(fd, 1) == b"")
            require(stable(before) == stable(os.fstat(fd))
                    == stable(os.stat(name, dir_fd=source.fd, follow_symlinks=False)))
            regular(os.fstat(fd), uid)
            source.verify()
            os.fsync(output)
        finally:
            os.close(output)
    finally:
        os.close(fd)


def remove_owned(directory_fd, names):
    for name in names:
        info = os.stat(name, dir_fd=directory_fd, follow_symlinks=False)
        require(stat.S_ISREG(info.st_mode) and info.st_uid == os.geteuid())
        os.unlink(name, dir_fd=directory_fd)


def publish(stage, backups, references, timestamp):
    """Exclusive entries; publish the DB last, only after all sealed evidence is present."""
    backups.verify()
    database = "app-" + timestamp + ".sqlite"
    evidence = "evidence-" + timestamp
    target_fd = None
    created = []
    database_created = False
    try:
        try:
            os.stat(database, dir_fd=backups.fd, follow_symlinks=False)
        except FileNotFoundError:
            pass
        else:
            raise BackupFailure()
        if references:
            os.mkdir(evidence, 0o750, dir_fd=backups.fd)
            target_fd = os.open(evidence, DIR_FLAGS, dir_fd=backups.fd)
            os.fchown(target_fd, os.geteuid(), os.fstat(backups.fd).st_gid)
            for name in references:
                os.link(name, name, src_dir_fd=stage.fd, dst_dir_fd=target_fd, follow_symlinks=False)
                created.append(name)
                os.unlink(name, dir_fd=stage.fd)
            os.fsync(target_fd)
        fd = os.open(PRIVATE_DB, READ_FLAGS, dir_fd=stage.fd)
        try:
            os.fchmod(fd, 0o640)
            os.fchown(fd, os.geteuid(), os.fstat(backups.fd).st_gid)
            os.fsync(fd)
        finally:
            os.close(fd)
        os.link(PRIVATE_DB, database, src_dir_fd=stage.fd, dst_dir_fd=backups.fd, follow_symlinks=False)
        database_created = True
        os.unlink(PRIVATE_DB, dir_fd=stage.fd)
        backups.verify()
        os.fsync(backups.fd)
    except BaseException:
        if database_created:
            remove_owned(backups.fd, [database])
        if target_fd is not None:
            remove_owned(target_fd, created)
            os.rmdir(evidence, dir_fd=backups.fd)
        raise
    finally:
        if target_fd is not None:
            os.close(target_fd)


def produce(data_path, backup_path, evidence_path, filename):
    require(sys.platform.startswith("linux") and sys.version_info >= (3, 8) and os.geteuid() == 0
            and os.getuid() == 0 and hasattr(os, "setresuid") and hasattr(os, "setresgid"))
    require(NAME.fullmatch(filename))
    resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
    directories = []
    stage = backups = None
    stage_name = None
    try:
        # First component walk permits only root-owned ancestors or the eventual source
        # owner. The DB inode supplies no executable code, paths, groups or privileges.
        candidate = os.lstat(data_path)
        owners = {0, candidate.st_uid}
        data = Directory(data_path, owners)
        directories.append(data)
        require(data.path != "/")
        db = os.stat(filename, dir_fd=data.fd, follow_symlinks=False)
        require(db.st_uid > 0)
        uid, gid = db.st_uid, local_primary_gid(db.st_uid)
        require(gid > 0 and db.st_gid == gid and candidate.st_uid in (0, uid))
        regular(db, uid)
        source_entries(data.fd, filename, uid)
        backups = Directory(backup_path, {0}, create=True)
        directories.append(backups)
        timestamp = time.strftime("%Y%m%dT%H%M%SZ", time.gmtime())
        stage_name = ".backup-stage-" + uuid.uuid4().hex
        os.mkdir(stage_name, 0o700, dir_fd=backups.fd)
        stage = Directory(backups.path + "/" + stage_name, {0})
        directories.append(stage)
        database_bytes = snapshot_database(data, stage, filename, uid, gid)
        references = snapshot_references(stage.path + "/" + PRIVATE_DB)
        require(database_bytes + sum(references.values()) <= MAX_BYTES)
        if references:
            source = Directory(evidence_path, {0, uid})
            directories.append(source)
            for name, size in references.items():
                copy_evidence(source, stage.fd, name, size, uid, os.fstat(backups.fd).st_gid)
            source.verify()
        # Evidence basenames cannot collide with the coordinator's private SQLite entry.
        stage.verify()
        publish(stage, backups, references, timestamp)
    finally:
        if stage is not None:
            names = os.listdir(stage.fd)
            require(len(names) <= MAX_REFERENCES + 1)
            remove_owned(stage.fd, names)
        for directory in reversed(directories):
            directory.close()
        if backups is not None and stage_name is not None:
            # Reopen only the protected destination; never recursively remove source paths.
            cleanup = Directory(backups.path, {0})
            try:
                os.rmdir(stage_name, dir_fd=cleanup.fd)
                os.fsync(cleanup.fd)
            finally:
                cleanup.close()
    print("BACKUP_PASS evidence_files=" + str(len(references))
          + " source_bytes=" + str(database_bytes + sum(references.values())))


def main():
    require(len(sys.argv) == 5)

    def expired(_signal, _frame):
        raise BackupFailure()

    signal.signal(signal.SIGALRM, expired)
    signal.alarm(180)
    try:
        produce(*sys.argv[1:])
    finally:
        signal.alarm(0)


if __name__ == "__main__":
    try:
        main()
    except BaseException:
        print("BACKUP_FAILED: unsupported/unsafe source, incomplete evidence, or destination conflict; no success attested.",
              file=sys.stderr)
        sys.exit(1)
