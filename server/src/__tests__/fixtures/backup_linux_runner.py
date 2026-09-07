"""Synthetic-only standalone Linux/root backup fixtures; no Node, network, installs or live data."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import selectors
import shutil
import sqlite3
import stat
import subprocess
import sys
import time
import uuid

CASES = (
    "wal-valid", "legacy", "shell-two-args", "shell-three-args",
    "db-symlink", "wal-symlink", "shm-symlink", "journal-symlink",
    "db-swap", "wal-swap", "retained-vfs-directory", "inherited-directory",
    "source-parent-symlink", "evidence-parent-symlink", "evidence-directory-swap",
    "db-hardlink", "evidence-hardlink", "evidence-fifo", "evidence-symlink",
    "changed-evidence", "swapped-evidence", "wrong-size", "missing-evidence",
    "traversal", "control-name", "nul-name", "overlong-name", "row-limit",
    "existing-db", "existing-evidence", "root-source-owner",
)
SUCCESS = {"wal-valid", "legacy", "shell-two-args", "shell-three-args", "inherited-directory"}
MARKER = b"SYNTHETIC BACKUP FIXTURES ONLY\n"
STAMP = "20260905T090000Z"
ENV = {"PATH": "/usr/bin:/bin", "LC_ALL": "C"}
PYTHON = "/usr/bin/python3"

WRITER = r"""
import os, sqlite3, sys
root, case = sys.argv[1:]
c = sqlite3.connect(root + "/data/custom.sqlite")
try:
    c.execute("PRAGMA journal_mode=WAL")
    c.execute("PRAGMA wal_autocheckpoint=0")
    c.execute("CREATE TABLE isolated_marker(value INTEGER)")
    c.execute("INSERT INTO isolated_marker VALUES (123)")
    if case != "legacy":
        c.execute("CREATE TABLE tactic_evidence(file_stored_name TEXT, file_size INTEGER)")
        c.execute("INSERT INTO tactic_evidence VALUES ('proof.txt', 3)")
        bad = {"traversal": "../outside.sqlite", "control-name": "bad\n.txt",
               "nul-name": "proof.txt\0suffix", "overlong-name": "a" * 201}
        if case in bad:
            c.execute("INSERT INTO tactic_evidence VALUES (?, 1)", (bad[case],))
        if case == "row-limit":
            c.executemany("INSERT INTO tactic_evidence VALUES ('proof.txt', 3)", [()] * 10000)
    c.commit()
    print("READY", flush=True)
    sys.stdin.readline()
finally:
    c.close()
"""


class Prerequisite(Exception):
    pass


def require(value):
    if not value:
        raise AssertionError("fixture invariant")


def protected(filename, directory=False):
    target = Path(filename)
    require(target.is_absolute() and str(target.resolve()) == str(target))
    for entry in (target, *target.parents):
        info = entry.lstat()
        require(not stat.S_ISLNK(info.st_mode) and info.st_uid == 0 and not info.st_mode & 0o022)
    info = target.lstat()
    require(stat.S_ISDIR(info.st_mode) if directory else stat.S_ISREG(info.st_mode) and info.st_nlink == 1)


def trusted_interpreter():
    for start in (Path(PYTHON), Path(PYTHON).resolve()):
        for entry in (start, *start.parents):
            info = entry.lstat()
            require(info.st_uid == 0)
            if not stat.S_ISLNK(info.st_mode):
                require(not info.st_mode & 0o022)
    require(Path(PYTHON).is_file() and os.access(PYTHON, os.X_OK))


def prerequisites():
    if not sys.platform.startswith("linux") or os.geteuid() != 0:
        raise Prerequisite("linux-root-required")
    if os.path.realpath(sys.executable) != os.path.realpath(PYTHON):
        raise Prerequisite("fixed-os-python-required")
    project = Path.cwd()
    if any(str(project) == item or str(project).startswith(item + "/") for item in (
        "/tmp", "/var/tmp", "/opt/12-week-dashboard", "/var/lib/12-week-dashboard", "/var/backups/12-week-dashboard",
    )):
        raise Prerequisite("dedicated-fixture-project-required")
    try:
        protected(project, directory=True)
        require(stat.S_IMODE(project.stat().st_mode) == 0o700)
        require(set(os.listdir(project)) == {"scripts", "tests", ".isolated-backup-fixture-project"})
        marker = project / ".isolated-backup-fixture-project"
        protected(marker)
        require(marker.stat().st_size == len(MARKER) and marker.read_bytes() == MARKER)
        require(set(os.listdir(project / "scripts")) == {"backup.sh", "backup_producer.py"})
        require(set(os.listdir(project / "tests")) == {"backup_linux_runner.py"})
        for entry in ("scripts/backup.sh", "scripts/backup_producer.py", "tests/backup_linux_runner.py"):
            protected(project / entry)
        trusted_interpreter()
        require(shutil.rmtree.avoids_symlink_attacks)
        status = Path("/proc/self/status").read_text("ascii")
        require(len(status) <= 16384)
        effective = int(next(line.split(":", 1)[1] for line in status.splitlines() if line.startswith("CapEff:")), 16)
        required = (1 << 0) | (1 << 6) | (1 << 7) | (1 << 18)
        require(effective & required == required)
    except Exception:
        raise Prerequisite("protected-project-or-kernel-prerequisite") from None
    spec = importlib.util.spec_from_file_location("reviewed_producer", project / "scripts/backup_producer.py")
    producer = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(producer)
    try:
        producer.sqlite_bounds()
        require(producer.local_primary_gid(65534) == 65534)
    except Exception:
        raise Prerequisite("sqlite-heap-or-local-fixture-account") from None
    return project, producer


def writer_start(root, case):
    child = subprocess.Popen([PYTHON, "-I", "-S", "-B", "-c", WRITER, str(root), case],
                             stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                             env=ENV, close_fds=True)
    try:
        with selectors.DefaultSelector() as selector:
            selector.register(child.stdout, selectors.EVENT_READ)
            require(bool(selector.select(10)))
        require(child.stdout.readline(16) == b"READY\n")
        return child
    except BaseException:
        writer_stop(child)
        raise


def writer_stop(child):
    if child.stdin:
        child.stdin.close()
    try:
        child.wait(timeout=10)
    except subprocess.TimeoutExpired:
        child.kill()
        child.wait(timeout=5)
    if child.stdout:
        child.stdout.close()


def synthetic_sentinel(filename):
    memory = sqlite3.connect(":memory:")
    output = sqlite3.connect(str(filename))
    try:
        memory.execute("CREATE TABLE synthetic_root_only(value INTEGER)")
        memory.execute("INSERT INTO synthetic_root_only VALUES (999)")
        memory.commit()
        memory.backup(output)
    finally:
        output.close()
        memory.close()
    os.chmod(filename, 0o600)


def fingerprint(filename):
    return hashlib.sha256(filename.read_bytes()).hexdigest()


def case_run(project, producer, root, case):
    root.mkdir(mode=0o700)
    data, backups = root / "data", root / "backups"
    data.mkdir(mode=0o700)
    backups.mkdir(mode=0o700)
    evidence = root / "separate-evidence" if case in ("shell-three-args", "evidence-parent-symlink") else data / "evidence"
    evidence.mkdir(mode=0o700)
    proof = evidence / "proof.txt"
    proof.write_bytes(b"abc")
    os.chmod(proof, 0o600)
    os.chown(proof, 65534, 65534)
    os.chown(evidence, 65534, 65534)
    writer = writer_start(root, case)
    original_connect, original_handles = producer.sqlite3.connect, producer.verify_worker_handles
    original_copy, original_read, original_stamp = producer.copy_evidence, producer.os.read, producer.time.strftime
    inherited = None
    try:
        for name in ("custom.sqlite", "custom.sqlite-wal", "custom.sqlite-shm"):
            os.chmod(data / name, 0o600)
            os.chown(data / name, 65534, 65534)
        os.chown(data, 65534, 65534)
        require((data / "custom.sqlite-wal").stat().st_size > 32)
        outside = root / "outside.sqlite"
        synthetic_sentinel(outside)
        sentinel_hash = fingerprint(outside)
        # A valid synthetic WAL attack fixture, not a raw-copy backup implementation.
        outside_wal = root / "outside.wal"
        outside_wal.write_bytes((data / "custom.sqlite-wal").read_bytes())
        os.chmod(outside_wal, 0o600)
        wal_hash = fingerprint(outside_wal)
        if case in ("db-symlink", "wal-symlink", "shm-symlink", "journal-symlink"):
            suffix = {"db-symlink": "", "wal-symlink": "-wal", "shm-symlink": "-shm", "journal-symlink": "-journal"}[case]
            target = data / ("custom.sqlite" + suffix)
            if target.exists():
                target.rename(str(target) + ".held")
            target.symlink_to(outside_wal if suffix == "-wal" else outside)
        if case == "source-parent-symlink":
            alias = root / "source-alias"
            alias.symlink_to(data, target_is_directory=True)
            data = alias
        if case == "evidence-parent-symlink":
            alias = root / "evidence-alias"
            alias.symlink_to(evidence, target_is_directory=True)
            evidence = alias
        if case == "db-hardlink":
            os.link(data / "custom.sqlite", root / "database-hardlink")
        if case == "evidence-hardlink":
            os.link(proof, root / "evidence-hardlink")
        if case in ("evidence-fifo", "evidence-symlink", "missing-evidence"):
            proof.unlink()
            if case == "evidence-fifo":
                os.mkfifo(proof, 0o600)
                os.chown(proof, 65534, 65534)
            elif case == "evidence-symlink":
                proof.symlink_to(outside)
        if case == "wrong-size":
            proof.write_bytes(b"too-long")
        if case == "root-source-owner":
            os.chown(data / "custom.sqlite", 0, 0)
        if case == "existing-db":
            (backups / ("app-" + STAMP + ".sqlite")).symlink_to(outside)
        if case == "existing-evidence":
            (backups / ("evidence-" + STAMP)).symlink_to(outside)
        if case == "inherited-directory":
            inherited = os.open(root, producer.DIR_FLAGS)

        def raced_connect(filename, *args, **kwargs):
            if case not in ("db-swap", "wal-swap") or not isinstance(filename, str) or not filename.startswith("file:/custom.sqlite?"):
                return original_connect(filename, *args, **kwargs)
            # Happens AFTER real chroot/drop; restore the pathname afterward so mere
            # post-checks cannot account for rejection of an out-of-jail read.
            target = "/custom.sqlite" + ("-wal" if case == "wal-swap" else "")
            os.rename(target, target + ".held")
            os.symlink(str(outside_wal if case == "wal-swap" else outside), target)
            try:
                connection = original_connect(filename, *args, **kwargs)
                try:
                    connection.execute("PRAGMA schema_version").fetchone()
                except BaseException:
                    connection.close()
                    raise
                return connection
            finally:
                os.unlink(target)
                os.rename(target + ".held", target)

        def retained_directory(*args):
            os.open(root, producer.DIR_FLAGS)
            original_handles(*args)

        changed = False

        def changing_read(fd, size):
            nonlocal changed
            if not changed:
                changed = True
                if case == "changed-evidence":
                    with proof.open("ab") as output:
                        output.write(b"x")
                else:
                    proof.rename(str(proof) + ".held")
                    proof.symlink_to(outside)
            return original_read(fd, size)

        def copying(source, *args):
            if case in ("changed-evidence", "swapped-evidence"):
                producer.os.read = changing_read
            if case == "evidence-directory-swap":
                evidence.rename(str(evidence) + ".held")
                evidence.symlink_to(backups, target_is_directory=True)
            try:
                return original_copy(source, *args)
            finally:
                producer.os.read = original_read

        producer.sqlite3.connect = raced_connect
        producer.copy_evidence = copying
        producer.time.strftime = lambda *_args: STAMP
        if case == "retained-vfs-directory":
            producer.verify_worker_handles = retained_directory
        rejected = False
        try:
            if case.startswith("shell-"):
                args = ["/bin/bash", str(project / "scripts/backup.sh"), str(data), str(backups)]
                if case == "shell-three-args":
                    args.append(str(evidence))
                result = subprocess.run(args, env={**ENV, "DB_FILE": "custom.sqlite"},
                                        stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=110)
                require(len(result.stdout) + len(result.stderr) <= 8192 and result.returncode == 0)
                require(b"BACKUP_PASS " in result.stdout)
            else:
                producer.produce(str(data), str(backups), str(evidence), "custom.sqlite")
        except Exception:
            rejected = True
        require(rejected == (case not in SUCCESS))
        writer_stop(writer)
        writer = None
        require(fingerprint(outside) == sentinel_hash and fingerprint(outside_wal) == wal_hash)
        require(not any(item.name.startswith(".backup-stage-") for item in backups.iterdir()))
        if case in SUCCESS:
            snapshots = [item for item in backups.iterdir() if re.fullmatch(r"app-\d{8}T\d{6}Z\.sqlite", item.name)]
            require(len(snapshots) == 1)
            # No connection remains open when the next producer forks.
            copy = original_connect(snapshots[0].as_uri() + "?mode=ro&immutable=1", uri=True)
            try:
                require(copy.execute("PRAGMA integrity_check").fetchall() == [("ok",)])
                require(copy.execute("SELECT value FROM isolated_marker").fetchall() == [(123,)])
            finally:
                copy.close()
            if case != "legacy":
                folder = snapshots[0].name.replace("app-", "evidence-", 1)[:-len(".sqlite")]
                require((backups / folder / "proof.txt").read_bytes() == b"abc")
        elif case not in ("existing-db", "existing-evidence"):
            require(list(backups.iterdir()) == [])
    finally:
        producer.sqlite3.connect = original_connect
        producer.verify_worker_handles = original_handles
        producer.copy_evidence = original_copy
        producer.os.read = original_read
        producer.time.strftime = original_stamp
        if inherited is not None:
            os.close(inherited)
        if writer is not None:
            writer_stop(writer)


def main():
    if sys.argv[1:] == ["--list"]:
        print(json.dumps({"cases": CASES, "count": len(CASES), "syntheticOnly": True}))
        return 0
    if sys.argv[1:] != ["--run"]:
        print("USAGE: backup_linux_runner.py --list|--run")
        return 2
    try:
        project, producer = prerequisites()
    except Prerequisite as error:
        print("RUNNER_NOT_RUN passed=0 failed=0 not_run=" + str(len(CASES)) + " reason=" + str(error))
        return 77
    except Exception:
        print("RUNNER_NOT_RUN passed=0 failed=0 not_run=" + str(len(CASES)) + " reason=prerequisite")
        return 77
    work = project / (".backup-linux-fixtures-" + uuid.uuid4().hex)
    work.mkdir(mode=0o700)
    passed = failed = executed = 0
    cleanup_failed = False
    try:
        for case in CASES:
            case_root = work / case
            try:
                case_run(project, producer, case_root, case)
                passed += 1
                print("CASE_PASS case=" + case, flush=True)
            except Exception as error:
                failed += 1
                print("CASE_FAIL case=" + case + " error=" + type(error).__name__, flush=True)
            finally:
                executed += 1
                if case_root.exists():
                    try:
                        shutil.rmtree(case_root)
                    except Exception:
                        cleanup_failed = True
                        print("CASE_CLEANUP_FAIL case=" + case, flush=True)
            # Do not credit negative cases when the positive real-kernel baseline failed.
            if cleanup_failed or (case == "wal-valid" and failed):
                break
    finally:
        try:
            shutil.rmtree(work)
        except Exception:
            cleanup_failed = True
            print("RUNNER_CLEANUP_FAIL", flush=True)
    print("RUNNER_RESULT passed=" + str(passed) + " failed=" + str(failed)
          + " not_run=" + str(len(CASES) - executed) + " cleanup_failed=" + str(int(cleanup_failed)))
    return 0 if passed == len(CASES) and failed == 0 and not cleanup_failed else 1


if __name__ == "__main__":
    sys.dont_write_bytecode = True
    try:
        code = main()
    except Exception:
        print("RUNNER_ABORTED reason=driver-prerequisite-or-cleanup")
        code = 1
    sys.exit(code)
