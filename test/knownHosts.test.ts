import { test } from "node:test";
import assert from "node:assert/strict";
import * as crypto from "crypto";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  appendKnownHost,
  keyTypeFromBlob,
  knownHostsName,
  knownKeyTypesForHost,
  parseKnownHosts,
  preferredHostKeyAlgorithms,
  verifyAgainstKnownHosts,
} from "../src/knownHosts";

const KEY_A = Buffer.concat([
  Buffer.from([0, 0, 0, 11]),
  Buffer.from("ssh-ed25519"),
  Buffer.from([0, 0, 0, 3]),
  Buffer.from("aaa"),
]).toString("base64");
const KEY_B = Buffer.concat([
  Buffer.from([0, 0, 0, 11]),
  Buffer.from("ssh-ed25519"),
  Buffer.from([0, 0, 0, 3]),
  Buffer.from("bbb"),
]).toString("base64");

function hashed(name: string): string {
  const salt = crypto.randomBytes(20);
  const mac = crypto.createHmac("sha1", salt).update(name).digest();
  return `|1|${salt.toString("base64")}|${mac.toString("base64")}`;
}

test("knownHostsName lowercases and brackets non-default ports", () => {
  assert.equal(knownHostsName("Web-01.Example.com", 22), "web-01.example.com");
  assert.equal(knownHostsName("10.0.0.5", 2222), "[10.0.0.5]:2222");
});

test("parseKnownHosts skips comments/blank lines and captures markers", () => {
  const entries = parseKnownHosts(
    "# comment\n\nhost1,host2 ssh-ed25519 AAAA comment here\n@revoked bad ssh-rsa BBBB\nshort line\n"
  );
  assert.equal(entries.length, 2);
  assert.deepEqual(entries[0].hosts, ["host1", "host2"]);
  assert.equal(entries[0].keyType, "ssh-ed25519");
  assert.equal(entries[0].keyBase64, "AAAA");
  assert.equal(entries[0].line, 3);
  assert.equal(entries[1].marker, "@revoked");
  assert.equal(entries[1].line, 4);
});

test("keyTypeFromBlob reads the leading SSH string", () => {
  assert.equal(keyTypeFromBlob(Buffer.from(KEY_A, "base64")), "ssh-ed25519");
  assert.equal(keyTypeFromBlob(Buffer.from([0, 0])), "");
});

test("verify: exact match, [host]:port, wildcard, hashed, case-insensitive", () => {
  const entries = parseKnownHosts(
    [
      `plain.example.com ssh-ed25519 ${KEY_A}`,
      `[10.0.0.5]:2222 ssh-ed25519 ${KEY_A}`,
      `*.wild.example.com ssh-ed25519 ${KEY_A}`,
      `${hashed("[hashed.example.com]:2200")} ssh-ed25519 ${KEY_A}`,
    ].join("\n")
  );
  assert.equal(verifyAgainstKnownHosts(entries, "plain.example.com", "ssh-ed25519", KEY_A).status, "ok");
  assert.equal(verifyAgainstKnownHosts(entries, "[10.0.0.5]:2222", "ssh-ed25519", KEY_A).status, "ok");
  assert.equal(verifyAgainstKnownHosts(entries, "10.0.0.5", "ssh-ed25519", KEY_A).status, "unknown");
  assert.equal(verifyAgainstKnownHosts(entries, "a.wild.example.com", "ssh-ed25519", KEY_A).status, "ok");
  assert.equal(verifyAgainstKnownHosts(entries, "PLAIN.example.com", "ssh-ed25519", KEY_A).status, "ok");
  assert.equal(
    verifyAgainstKnownHosts(entries, "[hashed.example.com]:2200", "ssh-ed25519", KEY_A).status,
    "ok"
  );
});

test("verify: mismatch, revoked, negation and other key types", () => {
  const entries = parseKnownHosts(
    [
      `mismatch.example.org ssh-ed25519 ${KEY_B}`,
      `@revoked revoked.example.com ssh-ed25519 ${KEY_A}`,
      `*.example.com,!excluded.example.com ssh-ed25519 ${KEY_A}`,
      `rsaonly.example.net ssh-rsa AAAAB3`,
      `@cert-authority *.example.net ssh-ed25519 ${KEY_A}`,
    ].join("\n")
  );
  const mismatch = verifyAgainstKnownHosts(entries, "mismatch.example.org", "ssh-ed25519", KEY_A);
  assert.equal(mismatch.status, "mismatch");
  assert.equal((mismatch as { line: number }).line, 1);

  assert.equal(verifyAgainstKnownHosts(entries, "revoked.example.com", "ssh-ed25519", KEY_A).status, "revoked");
  assert.equal(verifyAgainstKnownHosts(entries, "excluded.example.com", "ssh-ed25519", KEY_A).status, "unknown");
  assert.equal(verifyAgainstKnownHosts(entries, "included.example.com", "ssh-ed25519", KEY_A).status, "ok");

  const other = verifyAgainstKnownHosts(entries, "rsaonly.example.net", "ssh-ed25519", KEY_A);
  assert.equal(other.status, "unknown");
  assert.deepEqual((other as { otherTypes: string[] }).otherTypes, ["ssh-rsa"]);

  // @cert-authority entries are ignored, not treated as a trusted key.
  assert.equal(verifyAgainstKnownHosts(entries, "ca.example.net", "ssh-ed25519", KEY_A).status, "unknown");
});

test("known key types drive host key algorithm preference", () => {
  const entries = parseKnownHosts(
    [`h ssh-rsa AAAAB3`, `h ecdsa-sha2-nistp256 AAAAE2`, `other ssh-ed25519 ${KEY_A}`].join("\n")
  );
  assert.deepEqual(knownKeyTypesForHost(entries, "h"), ["ssh-rsa", "ecdsa-sha2-nistp256"]);
  const algos = preferredHostKeyAlgorithms(["ssh-rsa", "ecdsa-sha2-nistp256"]);
  assert.deepEqual(algos?.slice(0, 4), ["rsa-sha2-512", "rsa-sha2-256", "ssh-rsa", "ecdsa-sha2-nistp256"]);
  assert.equal(algos?.length, 7);
  assert.equal(new Set(algos).size, 7);
  assert.equal(preferredHostKeyAlgorithms([]), undefined);
  assert.equal(preferredHostKeyAlgorithms(["ssh-dss"]), undefined);
});

test("appendKnownHost creates the file and repairs a missing trailing newline", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ssh-mcp-kh-"));
  try {
    const file = path.join(dir, "nested", "known_hosts");
    appendKnownHost(file, "a", "ssh-ed25519", KEY_A);
    assert.equal(fs.readFileSync(file, "utf8"), `a ssh-ed25519 ${KEY_A}\n`);
    fs.writeFileSync(file, `a ssh-ed25519 ${KEY_A}`); // no trailing newline
    appendKnownHost(file, "b", "ssh-ed25519", KEY_B);
    assert.equal(fs.readFileSync(file, "utf8"), `a ssh-ed25519 ${KEY_A}\nb ssh-ed25519 ${KEY_B}\n`);
    assert.equal(parseKnownHosts(fs.readFileSync(file, "utf8")).length, 2);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
