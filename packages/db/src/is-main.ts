import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * True when `moduleUrl` is the entry point Node was started with.
 *
 * ESM has no `require.main === module`. Comparing real paths (rather than the
 * raw argv string) makes this correct on Windows, through symlinks, and when
 * the script is invoked with a relative path.
 */
export function isMainModule(moduleUrl: string): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return realpathSync(fileURLToPath(moduleUrl)) === realpathSync(resolve(entry));
  } catch {
    return false;
  }
}
