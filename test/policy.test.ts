import { test } from "node:test";
import assert from "node:assert/strict";
import { isHostAllowed, parseAllowedHosts } from "../src/policy";
import { loadConfig, parseHostKeyChecking } from "../src/config";

test("parseAllowedHosts trims, lowercases and drops empty items", () => {
  assert.deepEqual(parseAllowedHosts(" 10.0.0.5, Web-01 ,,*.Example.com "), [
    "10.0.0.5",
    "web-01",
    "*.example.com",
  ]);
  assert.deepEqual(parseAllowedHosts(undefined), []);
  assert.deepEqual(parseAllowedHosts(""), []);
});

test("an empty allowlist allows any host", () => {
  assert.equal(isHostAllowed("anything.example.net", []), true);
});

test("allowlist matches exact names, globs and is case-insensitive", () => {
  const allowed = parseAllowedHosts("10.0.0.5,*.example.com,web-0?");
  assert.equal(isHostAllowed("10.0.0.5", allowed), true);
  assert.equal(isHostAllowed("10.0.0.50", allowed), false);
  assert.equal(isHostAllowed("app.example.com", allowed), true);
  assert.equal(isHostAllowed("APP.EXAMPLE.COM", allowed), true);
  assert.equal(isHostAllowed("example.com", allowed), false);
  assert.equal(isHostAllowed("app.example.com.evil.net", allowed), false);
  assert.equal(isHostAllowed("web-01", allowed), true);
  assert.equal(isHostAllowed("web-010", allowed), false);
});

test("regex metacharacters in patterns are literal", () => {
  assert.equal(isHostAllowed("10x0x0x5", ["10.0.0.5"]), false);
  assert.equal(isHostAllowed("a+b.example.com", ["a+b.example.com"]), true);
});

test("parseHostKeyChecking defaults to strict and rejects unknown values", () => {
  const warnings: string[] = [];
  const warn = (m: string) => warnings.push(m);
  assert.equal(parseHostKeyChecking(undefined, warn), "strict");
  assert.equal(parseHostKeyChecking("", warn), "strict");
  assert.equal(parseHostKeyChecking("Accept-New", warn), "accept-new");
  assert.equal(parseHostKeyChecking("off", warn), "off");
  assert.equal(warnings.length, 0);
  assert.equal(parseHostKeyChecking("yes", warn), "strict");
  assert.equal(warnings.length, 1);
});

test("loadConfig reads the new variables and keeps v1.0.0 defaults", () => {
  const cfg = loadConfig(
    {
      SSH_MCP_ALLOWED_HOSTS: "a,b",
      SSH_MCP_HOST_KEY_CHECKING: "accept-new",
      SSH_MCP_KNOWN_HOSTS: "/tmp/kh",
      SSH_MCP_AUDIT_LOG: "/tmp/audit.log",
    },
    () => {}
  );
  assert.deepEqual(cfg.allowedHosts, ["a", "b"]);
  assert.equal(cfg.hostKeyChecking, "accept-new");
  assert.equal(cfg.knownHostsPath, "/tmp/kh");
  assert.equal(cfg.auditLogPath, "/tmp/audit.log");
  assert.equal(cfg.defaultUser, "root");
  assert.equal(cfg.defaultPort, 22);
  assert.equal(cfg.defaultTimeoutMs, 60000);

  const bare = loadConfig({}, () => {});
  assert.deepEqual(bare.allowedHosts, []);
  assert.equal(bare.hostKeyChecking, "strict");
  assert.match(bare.knownHostsPath, /\.ssh\/known_hosts$/);
  assert.equal(bare.auditLogPath, undefined);
});
