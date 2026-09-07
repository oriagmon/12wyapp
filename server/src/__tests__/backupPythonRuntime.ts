import { execFileSync } from 'node:child_process';

export interface PythonCapability {
  executable: string;
  available: boolean;
  supported: boolean;
  python?: string;
  sqlite?: string;
  heapLimit?: number;
}

const probe = `
import json, sqlite3, sys
c = sqlite3.connect(":memory:")
try:
    assigned = c.execute("PRAGMA hard_heap_limit=67108864").fetchone()
    current = c.execute("PRAGMA hard_heap_limit").fetchone()
    supported = (sys.version_info >= (3, 8) and sqlite3.sqlite_version_info >= (3, 31, 0)
        and assigned is not None and current is not None
        and isinstance(assigned[0], int) and 0 < assigned[0] <= 67108864
        and isinstance(current[0], int) and 0 < current[0] <= 67108864)
    print(json.dumps({"supported": supported, "python": sys.version.split()[0],
                      "sqlite": sqlite3.sqlite_version, "heapLimit": current[0] if current else None}))
finally:
    c.close()
`;

function capability(executable: string): PythonCapability {
  try {
    const output = execFileSync(executable, ['-I', '-S', '-B', '-c', probe], {
      encoding: 'utf8', timeout: 5000, maxBuffer: 4096,
      env: { PATH: '/usr/bin:/bin', LC_ALL: 'C' },
    });
    return { ...JSON.parse(output), executable, available: true };
  } catch {
    return { executable, available: false, supported: false };
  }
}

export const fixedPythonCapability = capability('/usr/bin/python3');
// Test-only local alternative. Root/Linux checks ALWAYS use the production OS interpreter.
// Never download anything, consult PATH dynamically, or add a production override.
export const sqliteTestCapability = fixedPythonCapability.supported
  ? fixedPythonCapability
  : process.platform === 'darwin' && process.getuid?.() !== 0
    ? capability('/opt/homebrew/bin/python3.13')
    : fixedPythonCapability;
