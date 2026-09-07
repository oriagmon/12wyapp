"""Source-only fragment for the parent's root-owned final-release helper.

Call only after its bounded ARM plan positively confirms the existing desired sender.
No CLI entry point, network, credential-file access, systemctl call, or email sending.
The returned drop-in text must be appended LAST by the reviewed release helper;
it must preserve all existing approved credential/public EnvironmentFile entries.
"""
import os
import stat


def install_verified_sender_override(confirmed_address):
    address = "12wyapp@1d3707be-5f1f-4a36-aa66-9938a4983103.azurecomm.net"
    if os.geteuid() != 0 or confirmed_address != address:
        raise ValueError("verified sender installation prerequisite")
    payload = ("EMAIL_SENDER_ADDRESS=" + address + "\n").encode("ascii")
    filename = "12-week-dashboard-sender.env"
    directory = os.open("/etc", os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC)
    try:
        parent = os.fstat(directory)
        if parent.st_uid != 0 or parent.st_mode & 0o022:
            raise ValueError("sender directory is not root-controlled")
        try:
            output = os.open(filename, os.O_WRONLY | os.O_CREAT | os.O_EXCL |
                             os.O_NOFOLLOW | os.O_CLOEXEC, 0o600, dir_fd=directory)
        except FileExistsError:
            existing = os.open(filename, os.O_RDONLY | os.O_NOFOLLOW |
                               os.O_NONBLOCK | os.O_CLOEXEC, dir_fd=directory)
            try:
                metadata = os.fstat(existing)
                if (not stat.S_ISREG(metadata.st_mode) or metadata.st_nlink != 1
                        or metadata.st_uid != 0 or metadata.st_gid != 0
                        or stat.S_IMODE(metadata.st_mode) != 0o600
                        or metadata.st_size != len(payload)
                        or os.read(existing, len(payload) + 1) != payload):
                    raise ValueError("unexpected existing sender override")
            finally:
                os.close(existing)
        else:
            try:
                os.fchown(output, 0, 0)
                os.fchmod(output, 0o600)
                remaining = memoryview(payload)
                while remaining:
                    written = os.write(output, remaining)
                    if written <= 0:
                        raise OSError("incomplete sender override write")
                    remaining = remaining[written:]
                os.fsync(output)
            except BaseException:
                os.unlink(filename, dir_fd=directory)
                raise
            finally:
                os.close(output)
            os.fsync(directory)
    finally:
        os.close(directory)
    return "[Service]\nEnvironmentFile=/etc/12-week-dashboard-sender.env\n"
