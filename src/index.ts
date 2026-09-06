#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { loadConfig, readPackageVersion } from "./config";
import { runTool, toolDefinitions } from "./tools";

// All host-specific configuration comes from environment variables; see README.
const config = loadConfig();
const version = readPackageVersion();

const server = new Server(
  { name: "ssh-mcp-dynamic", version },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: toolDefinitions(config),
}));

server.setRequestHandler(CallToolRequestSchema, async (request) =>
  runTool(request.params.name, request.params.arguments, config)
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  const allowed = config.allowedHosts.length ? config.allowedHosts.join(",") : "any";
  const audit = config.auditLogPath ? `stderr + ${config.auditLogPath}` : "stderr";
  process.stderr.write(
    `ssh-mcp-dynamic v${version} running on stdio ` +
      `(host key checking: ${config.hostKeyChecking}, known_hosts: ${config.knownHostsPath}, ` +
      `allowed hosts: ${allowed}, audit: ${audit})\n`
  );
}

main().catch((err) => {
  process.stderr.write(`Fatal error: ${err.message}\n`);
  process.exit(1);
});
