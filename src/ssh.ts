import { Client, ConnectConfig } from "ssh2";
import * as fs from "fs";
import type { HostVerification } from "./knownHosts";

export interface ExecRequest {
  host: string;
  port: number;
  user: string;
  keyPath: string;
  command: string;
  timeoutMs: number;
  verification: HostVerification;
}

export interface ExecResult {
  stdout: string;
  stderr: string;
  /** null when the remote side closed the channel without an exit status. */
  code: number | null;
}

export type Executor = (request: ExecRequest) => Promise<ExecResult>;

// Resolves once the command has run (whatever its exit code). Rejects on
// connection, host key, timeout or channel setup failures.
export const sshExec: Executor = (request) => {
  const { host, port, user, keyPath, command, timeoutMs, verification } = request;

  return new Promise<ExecResult>((resolve, reject) => {
    const conn = new Client();
    let stdout = "";
    let stderr = "";
    let settled = false;

    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };

    const timer = setTimeout(() => {
      finish(() => {
        conn.destroy();
        reject(new Error(`Command timed out after ${timeoutMs}ms: ${command}`));
      });
    }, timeoutMs);

    const connectionFailure = (fallback: string): Error =>
      new Error(verification.failure() ?? fallback);

    conn
      .on("ready", () => {
        conn.exec(command, (err, stream) => {
          if (err) {
            return finish(() => {
              conn.end();
              reject(err);
            });
          }
          stream
            .on("close", (code: number | null) => {
              finish(() => {
                conn.end();
                resolve({ stdout, stderr, code: typeof code === "number" ? code : null });
              });
            })
            .on("data", (data: Buffer) => {
              stdout += data.toString();
            })
            .stderr.on("data", (data: Buffer) => {
              stderr += data.toString();
            });
        });
      })
      .on("error", (err) => {
        finish(() => reject(connectionFailure(`SSH connection error: ${err.message}`)));
      })
      .on("close", () => {
        finish(() => reject(connectionFailure("SSH connection closed before the command completed")));
      });

    const config: ConnectConfig = {
      host,
      port,
      username: user,
      privateKey: fs.readFileSync(keyPath),
      readyTimeout: timeoutMs,
      keepaliveInterval: 10000,
      keepaliveCountMax: 3,
    };
    if (verification.hostVerifier) config.hostVerifier = verification.hostVerifier;
    if (verification.serverHostKeyAlgorithms) {
      config.algorithms = { serverHostKey: verification.serverHostKeyAlgorithms };
    }
    conn.connect(config);
  });
};
