import { Server, utils } from "ssh2";
import type { ParsedKey, PublicKeyAuthContext } from "ssh2";
import type { AddressInfo } from "net";

export interface TestSshServer {
  port: number;
  hostPublicKey: { type: string; base64: string };
  readonly connections: number;
  readonly execs: string[];
  close(): Promise<void>;
}

function firstKey(parsed: ParsedKey | ParsedKey[] | Error): ParsedKey {
  if (parsed instanceof Error) throw parsed;
  return Array.isArray(parsed) ? parsed[0] : parsed;
}

// In-process SSH server: ed25519 host key, publickey auth for one client key,
// and an `exec` handler with canned behaviours:
//   "fail"  -> stderr "boom", exit 3
//   "mixed" -> stdout "out", stderr "warn", exit 0
//   other   -> stdout "ran: <command>", exit 0
export async function startSshServer(clientPublicKey: string): Promise<TestSshServer> {
  const hostKeys = utils.generateKeyPairSync("ed25519");
  const hostPub = firstKey(utils.parseKey(hostKeys.public));
  const allowed = firstKey(utils.parseKey(clientPublicKey));
  const state = { connections: 0, execs: [] as string[] };

  const server = new Server({ hostKeys: [hostKeys.private] }, (client) => {
    state.connections += 1;
    client
      .on("authentication", (ctx) => {
        if (ctx.method !== "publickey") return ctx.reject(["publickey"]);
        const pk = ctx as PublicKeyAuthContext;
        if (pk.key.algo !== allowed.type || !pk.key.data.equals(allowed.getPublicSSH())) {
          return ctx.reject();
        }
        if (pk.signature && pk.blob && allowed.verify(pk.blob, pk.signature, pk.hashAlgo) !== true) {
          return ctx.reject();
        }
        ctx.accept();
      })
      .on("ready", () => {
        client.on("session", (accept) => {
          const session = accept();
          session.once("exec", (acceptExec, _reject, info) => {
            state.execs.push(info.command);
            const stream = acceptExec();
            const bare = info.command.replace(/^sudo /, "");
            if (bare === "fail") {
              stream.stderr.write("boom\n");
              stream.exit(3);
            } else if (bare === "mixed") {
              stream.write("out\n");
              stream.stderr.write("warn\n");
              stream.exit(0);
            } else {
              stream.write(`ran: ${info.command}\n`);
              stream.exit(0);
            }
            stream.end();
          });
        });
      })
      .on("error", () => {
        /* client-side aborts (e.g. host key refusal) are expected in tests */
      });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;

  return {
    port,
    hostPublicKey: { type: hostPub.type, base64: hostPub.getPublicSSH().toString("base64") },
    get connections() {
      return state.connections;
    },
    get execs() {
      return state.execs;
    },
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

export function makeHostKeyPair(): { type: string; base64: string } {
  const keys = utils.generateKeyPairSync("ed25519");
  const pub = firstKey(utils.parseKey(keys.public));
  return { type: pub.type, base64: pub.getPublicSSH().toString("base64") };
}
