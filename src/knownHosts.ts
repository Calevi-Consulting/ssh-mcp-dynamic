import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import { globToRegExp } from "./policy";
import type { HostKeyChecking } from "./config";
import type { ServerHostKeyAlgorithm } from "ssh2";

// ---------------------------------------------------------------------------
// OpenSSH known_hosts parsing and host key verification.
// Format: [@marker] host1,host2,... keytype base64 [comment]
// Hosts may be plain names, `[host]:port`, `*`/`?` globs, `!`-negated
// patterns, or hashed `|1|<salt>|<hmac-sha1>` entries.
// ---------------------------------------------------------------------------

export interface KnownHostEntry {
  hosts: string[];
  keyType: string;
  keyBase64: string;
  marker?: string;
  line: number;
}

export function knownHostsName(host: string, port: number): string {
  const lower = host.toLowerCase();
  return port === 22 ? lower : `[${lower}]:${port}`;
}

export function parseKnownHosts(text: string): KnownHostEntry[] {
  const entries: KnownHostEntry[] = [];
  text.split(/\r?\n/).forEach((raw, index) => {
    const line = raw.trim();
    if (!line || line.startsWith("#")) return;
    const parts = line.split(/\s+/);
    let marker: string | undefined;
    if (parts[0].startsWith("@")) marker = parts.shift();
    if (parts.length < 3) return;
    const [hosts, keyType, keyBase64] = parts;
    entries.push({ hosts: hosts.split(","), keyType, keyBase64, marker, line: index + 1 });
  });
  return entries;
}

function hostPatternMatches(pattern: string, name: string): boolean {
  if (pattern.startsWith("|1|")) {
    const [, , saltB64, hashB64] = pattern.split("|");
    if (!saltB64 || !hashB64) return false;
    const mac = crypto.createHmac("sha1", Buffer.from(saltB64, "base64")).update(name).digest();
    const expected = Buffer.from(hashB64, "base64");
    return mac.length === expected.length && crypto.timingSafeEqual(mac, expected);
  }
  return globToRegExp(pattern).test(name);
}

export function entryMatchesHost(entry: KnownHostEntry, name: string): boolean {
  let matched = false;
  for (const pattern of entry.hosts) {
    if (pattern.startsWith("!")) {
      if (hostPatternMatches(pattern.slice(1), name)) return false;
    } else if (hostPatternMatches(pattern, name)) {
      matched = true;
    }
  }
  return matched;
}

// The key type is the first SSH string in the wire-format public key blob.
export function keyTypeFromBlob(blob: Buffer): string {
  if (blob.length < 4) return "";
  const len = blob.readUInt32BE(0);
  if (blob.length < 4 + len) return "";
  return blob.subarray(4, 4 + len).toString("ascii");
}

export type VerifyOutcome =
  | { status: "ok" }
  | { status: "unknown"; otherTypes: string[] }
  | { status: "mismatch"; line: number }
  | { status: "revoked"; line: number };

export function verifyAgainstKnownHosts(
  entries: KnownHostEntry[],
  name: string,
  keyType: string,
  keyBase64: string
): VerifyOutcome {
  const applicable = entries.filter((e) => entryMatchesHost(e, name));

  for (const e of applicable) {
    if (e.marker === "@revoked" && e.keyType === keyType && e.keyBase64 === keyBase64) {
      return { status: "revoked", line: e.line };
    }
  }

  const otherTypes = new Set<string>();
  let mismatchLine: number | undefined;
  for (const e of applicable) {
    if (e.marker) continue; // @revoked handled above; @cert-authority and unknown markers are ignored
    if (e.keyType !== keyType) {
      otherTypes.add(e.keyType);
      continue;
    }
    if (e.keyBase64 === keyBase64) return { status: "ok" };
    mismatchLine ??= e.line;
  }
  if (mismatchLine !== undefined) return { status: "mismatch", line: mismatchLine };
  return { status: "unknown", otherTypes: [...otherTypes] };
}

export function knownKeyTypesForHost(entries: KnownHostEntry[], name: string): string[] {
  const types: string[] = [];
  for (const e of entries) {
    if (e.marker || !entryMatchesHost(e, name)) continue;
    if (!types.includes(e.keyType)) types.push(e.keyType);
  }
  return types;
}

// Host key algorithms ssh2 1.x can negotiate, in its default preference order.
const SUPPORTED_HOST_KEY_ALGORITHMS: ServerHostKeyAlgorithm[] = [
  "ssh-ed25519",
  "ecdsa-sha2-nistp256",
  "ecdsa-sha2-nistp384",
  "ecdsa-sha2-nistp521",
  "rsa-sha2-512",
  "rsa-sha2-256",
  "ssh-rsa",
];

// Put the key types we already trust for this host first, so the server
// presents a key we can verify instead of one we have never seen.
export function preferredHostKeyAlgorithms(knownTypes: string[]): ServerHostKeyAlgorithm[] | undefined {
  const preferred: ServerHostKeyAlgorithm[] = [];
  for (const type of knownTypes) {
    const algorithms = type === "ssh-rsa" ? ["rsa-sha2-512", "rsa-sha2-256", "ssh-rsa"] : [type];
    for (const algorithm of algorithms) {
      const supported = SUPPORTED_HOST_KEY_ALGORITHMS.find((a) => a === algorithm);
      if (supported && !preferred.includes(supported)) {
        preferred.push(supported);
      }
    }
  }
  if (preferred.length === 0) return undefined;
  return preferred.concat(SUPPORTED_HOST_KEY_ALGORITHMS.filter((a) => !preferred.includes(a)));
}

export function readKnownHosts(filePath: string): KnownHostEntry[] {
  try {
    return parseKnownHosts(fs.readFileSync(filePath, "utf8"));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
}

export function appendKnownHost(filePath: string, name: string, keyType: string, keyBase64: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  let prefix = "";
  try {
    const stat = fs.statSync(filePath);
    if (stat.size > 0) {
      const fd = fs.openSync(filePath, "r");
      try {
        const last = Buffer.alloc(1);
        fs.readSync(fd, last, 0, 1, stat.size - 1);
        if (last[0] !== 0x0a) prefix = "\n";
      } finally {
        fs.closeSync(fd);
      }
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
  fs.appendFileSync(filePath, `${prefix}${name} ${keyType} ${keyBase64}\n`, { mode: 0o600 });
}

// ---------------------------------------------------------------------------
// Per-connection verifier wired into ssh2's `hostVerifier` option.
// ---------------------------------------------------------------------------

export interface HostKeyPolicy {
  mode: HostKeyChecking;
  knownHostsPath: string;
}

export interface HostVerification {
  /** Undefined when checking is off (ssh2 then accepts any key). */
  hostVerifier?: (key: Buffer) => boolean;
  /** Undefined when known_hosts has nothing for this host (ssh2 defaults apply). */
  serverHostKeyAlgorithms?: ServerHostKeyAlgorithm[];
  /** Human-readable reason the key was refused, once the verifier has run. */
  failure: () => string | undefined;
}

export function createHostVerification(host: string, port: number, policy: HostKeyPolicy): HostVerification {
  if (policy.mode === "off") return { failure: () => undefined };

  const name = knownHostsName(host, port);
  const file = policy.knownHostsPath;
  const entries = readKnownHosts(file);
  let failure: string | undefined;

  const hostVerifier = (key: Buffer): boolean => {
    const keyType = keyTypeFromBlob(key);
    const keyBase64 = key.toString("base64");
    const outcome = verifyAgainstKnownHosts(entries, name, keyType, keyBase64);

    switch (outcome.status) {
      case "ok":
        return true;
      case "revoked":
        failure = `Host key for ${name} is marked @revoked in ${file} (line ${outcome.line}). Refusing to connect.`;
        return false;
      case "mismatch":
        failure =
          `HOST KEY MISMATCH for ${name}: the ${keyType} key presented by the server does not match ` +
          `${file} line ${outcome.line}. This can indicate a man-in-the-middle attack or a rebuilt host. ` +
          `Refusing to connect. If the change is expected, remove that line and reconnect.`;
        return false;
      case "unknown": {
        if (policy.mode === "accept-new") {
          try {
            appendKnownHost(file, name, keyType, keyBase64);
            return true;
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            failure = `Could not record the host key for ${name} in ${file}: ${message}. Refusing to connect.`;
            return false;
          }
        }
        const others = outcome.otherTypes.length
          ? ` (entries of other key types exist: ${outcome.otherTypes.join(", ")})`
          : "";
        failure =
          `Host key verification failed: ${name} is not in ${file}${others}. ` +
          `Connect once with 'ssh' to record it, or set SSH_MCP_HOST_KEY_CHECKING=accept-new.`;
        return false;
      }
    }
  };

  return {
    hostVerifier,
    serverHostKeyAlgorithms: preferredHostKeyAlgorithms(knownKeyTypesForHost(entries, name)),
    failure: () => failure,
  };
}
