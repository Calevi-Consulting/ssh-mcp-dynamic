import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import * as crypto from "crypto";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { utils } from "ssh2";
import { makeHostKeyPair, startSshServer, TestSshServer } from "./helpers";
import { runTool } from "../src/tools";
import type { Config } from "../src/config";

const HOST = "127.0.0.1";
let server: TestSshServer;
let tmp: string;
let keyPath: string;
let counter = 0;

const quiet = { stderr: () => {} };

before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ssh-mcp-it-"));
  const clientKeys = utils.generateKeyPairSync("ed25519");
  keyPath = path.join(tmp, "client.key");
  fs.writeFileSync(keyPath, clientKeys.private, { mode: 0o600 });
  server = await startSshServer(clientKeys.public);
});

after(async () => {
  await server.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

function knownName(): string {
  return `[${HOST}]:${server.port}`;
}

function trustedLine(): string {
  return `${knownName()} ${server.hostPublicKey.type} ${server.hostPublicKey.base64}\n`;
}

function makeConfig(overrides: Partial<Config> = {}): Config {
  counter += 1;
  return {
    defaultUser: "tester",
    defaultPort: server.port,
    defaultTimeoutMs: 5000,
    defaultKey: keyPath,
    keyShortcuts: {},
    allowedHosts: [],
    hostKeyChecking: "strict",
    knownHostsPath: path.join(tmp, `known_hosts_${counter}`),
    auditLogPath: undefined,
    ...overrides,
  };
}

function trustedConfig(overrides: Partial<Config> = {}): Config {
  const cfg = makeConfig(overrides);
  fs.writeFileSync(cfg.knownHostsPath, trustedLine());
  return cfg;
}

test("AC3: strict mode refuses an unknown host and never runs the command", async () => {
  const cfg = makeConfig();
  const execs = server.execs.length;
  const res = await runTool("ssh_exec", { host: HOST, command: "hostname" }, cfg, quiet);
  assert.equal(res.isError, true);
  assert.match(res.content[0].text, /Host key verification failed/);
  assert.match(res.content[0].text, /accept-new/);
  assert.equal(server.execs.length, execs);
  assert.equal(fs.existsSync(cfg.knownHostsPath), false);
});

test("AC4: accept-new records the host key and strict then succeeds against it", async () => {
  const cfg = makeConfig({ hostKeyChecking: "accept-new" });
  const first = await runTool("ssh_exec", { host: HOST, command: "hostname" }, cfg, quiet);
  assert.equal(first.isError, undefined);
  assert.equal(first.content[0].text, "ran: hostname\n");
  assert.equal(fs.readFileSync(cfg.knownHostsPath, "utf8"), trustedLine());

  const strict = { ...cfg, hostKeyChecking: "strict" as const };
  const second = await runTool("ssh_exec", { host: HOST, command: "uptime" }, strict, quiet);
  assert.equal(second.isError, undefined);
  assert.equal(second.content[0].text, "ran: uptime\n");
});

test("AC5: a mismatched host key is refused in strict and accept-new modes", async () => {
  const rogue = makeHostKeyPair();
  for (const mode of ["strict", "accept-new"] as const) {
    const cfg = makeConfig({ hostKeyChecking: mode });
    fs.writeFileSync(cfg.knownHostsPath, `${knownName()} ${rogue.type} ${rogue.base64}\n`);
    const execs = server.execs.length;
    const res = await runTool("ssh_exec", { host: HOST, command: "hostname" }, cfg, quiet);
    assert.equal(res.isError, true, mode);
    assert.match(res.content[0].text, /HOST KEY MISMATCH/, mode);
    assert.equal(server.execs.length, execs, mode);
    // The file must not have been "repaired" by accept-new.
    assert.equal(fs.readFileSync(cfg.knownHostsPath, "utf8"), `${knownName()} ${rogue.type} ${rogue.base64}\n`);
  }
});

test("AC6: a hashed known_hosts entry is matched in strict mode", async () => {
  const cfg = makeConfig();
  const salt = crypto.randomBytes(20);
  const mac = crypto.createHmac("sha1", salt).update(knownName()).digest();
  const pattern = `|1|${salt.toString("base64")}|${mac.toString("base64")}`;
  fs.writeFileSync(cfg.knownHostsPath, `${pattern} ${server.hostPublicKey.type} ${server.hostPublicKey.base64}\n`);
  const res = await runTool("ssh_exec", { host: HOST, command: "hostname" }, cfg, quiet);
  assert.equal(res.isError, undefined);
  assert.equal(res.content[0].text, "ran: hostname\n");
});

test("AC7: off mode connects without consulting or creating known_hosts", async () => {
  const cfg = makeConfig({ hostKeyChecking: "off", knownHostsPath: path.join(tmp, "does-not-exist") });
  const res = await runTool("ssh_exec", { host: HOST, command: "hostname" }, cfg, quiet);
  assert.equal(res.isError, undefined);
  assert.equal(res.content[0].text, "ran: hostname\n");
  assert.equal(fs.existsSync(cfg.knownHostsPath), false);
});

test("AC1/AC2: allowlist denies before connecting and admits matching globs", async () => {
  const denied = trustedConfig({ allowedHosts: ["10.0.0.*", "web-01"] });
  const connections = server.connections;
  const res = await runTool("ssh_exec", { host: HOST, command: "hostname" }, denied, quiet);
  assert.equal(res.isError, true);
  assert.match(res.content[0].text, /not in SSH_MCP_ALLOWED_HOSTS/);
  assert.equal(server.connections, connections);

  const allowed = trustedConfig({ allowedHosts: ["10.0.0.*", "127.0.0.?"] });
  const ok = await runTool("ssh_exec", { host: HOST, command: "hostname" }, allowed, quiet);
  assert.equal(ok.isError, undefined);
  assert.equal(ok.content[0].text, "ran: hostname\n");
});

test("AC8: one JSON audit line per call with outcome and exit code", async () => {
  const auditLogPath = path.join(tmp, "audit", "ssh-mcp.log");
  const cfg = trustedConfig({ auditLogPath, allowedHosts: ["127.0.0.1"] });
  const stderrLines: string[] = [];
  const deps = { stderr: (t: string) => stderrLines.push(t) };

  await runTool("ssh_exec", { host: HOST, command: "hostname" }, cfg, deps);
  await runTool("ssh_sudo_exec", { host: HOST, command: "fail", user: "ops" }, cfg, deps);
  await runTool("ssh_exec", { host: "10.9.9.9", command: "id" }, cfg, deps);

  const lines = fs.readFileSync(auditLogPath, "utf8").trim().split("\n");
  assert.equal(lines.length, 3);
  assert.equal(stderrLines.length, 3);
  const [ok, failed, denied] = lines.map((l) => JSON.parse(l));

  assert.equal(ok.tool, "ssh_exec");
  assert.equal(ok.host, HOST);
  assert.equal(ok.port, server.port);
  assert.equal(ok.user, "tester");
  assert.equal(ok.key, keyPath);
  assert.equal(ok.command, "hostname");
  assert.equal(ok.outcome, "ok");
  assert.equal(ok.exit_code, 0);
  assert.equal(typeof ok.duration_ms, "number");
  assert.ok(!Number.isNaN(Date.parse(ok.ts)));
  assert.equal("error" in ok, false);

  assert.equal(failed.tool, "ssh_sudo_exec");
  assert.equal(failed.user, "ops");
  assert.equal(failed.command, "sudo fail");
  assert.equal(failed.outcome, "error");
  assert.equal(failed.exit_code, 3);

  assert.equal(denied.host, "10.9.9.9");
  assert.equal(denied.outcome, "denied");
  assert.match(denied.error, /SSH_MCP_ALLOWED_HOSTS/);
  assert.equal("exit_code" in denied, false);

  // Never log command output.
  assert.equal(JSON.stringify(lines).includes("ran: hostname"), false);
});

test("AC8b: host key refusals are audited as denied", async () => {
  const cfg = makeConfig({ auditLogPath: path.join(tmp, "audit-hostkey.log") });
  await runTool("ssh_exec", { host: HOST, command: "hostname" }, cfg, quiet);
  const [event] = fs.readFileSync(cfg.auditLogPath!, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  assert.equal(event.outcome, "denied");
  assert.match(event.error, /Host key verification failed/);
});

test("AC9: tool response formatting is unchanged from v1.0.0", async () => {
  const cfg = trustedConfig();
  const mixed = await runTool("ssh_exec", { host: HOST, command: "mixed" }, cfg, quiet);
  assert.equal(mixed.isError, undefined);
  assert.equal(mixed.content[0].text, "out\n\n[stderr]\nwarn\n");

  const failed = await runTool("ssh_exec", { host: HOST, command: "fail" }, cfg, quiet);
  assert.equal(failed.isError, true);
  assert.equal(failed.content[0].text, "ERROR: Exit code 3: boom\n");
});

test("AC10: ssh_sudo_exec prefixes the command with sudo", async () => {
  const cfg = trustedConfig();
  const res = await runTool("ssh_sudo_exec", { host: HOST, command: "whoami" }, cfg, quiet);
  assert.equal(res.content[0].text, "ran: sudo whoami\n");
  assert.equal(server.execs[server.execs.length - 1], "sudo whoami");
});

test("parameter validation still throws as in v1.0.0", async () => {
  const cfg = trustedConfig();
  await assert.rejects(runTool("ssh_exec", { command: "x" }, cfg, quiet), /'host' is required/);
  await assert.rejects(runTool("ssh_exec", { host: HOST }, cfg, quiet), /'command' is required/);
  await assert.rejects(
    runTool("ssh_exec", { host: HOST, command: "x" }, { ...cfg, defaultKey: "" }, quiet),
    /'key' is required/
  );
  await assert.rejects(
    runTool("ssh_exec", { host: HOST, command: "x", key: path.join(tmp, "missing.pem") }, cfg, quiet),
    /PEM key file not found/
  );
  await assert.rejects(runTool("nope", { host: HOST, command: "x" }, cfg, quiet), /Unknown tool/);
});
