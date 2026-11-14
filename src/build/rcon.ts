import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { connect, createServer, type Socket } from "node:net";
import { join } from "node:path";

/** RCON settings of a dedicated server run. */
export interface RconConfig {
  port: number;
  password: string;
}

/** A free TCP port on this machine. */
export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address() as { port: number };
      probe.close(() => resolve(port));
    });
  });
}

/**
 * Turns RCON on in run/server.properties of a generated engine folder (other properties stay) with a fresh port and
 * password, so a tool can send commands to the server it starts. The server reads the file when it starts.
 */
export async function enableRcon(projectDir: string): Promise<RconConfig> {
  const config = { port: await freePort(), password: randomBytes(12).toString("hex") };
  const file = join(projectDir, "run", "server.properties");
  const lines = existsSync(file) ? readFileSync(file, "utf8").split(/\r?\n/).filter((l) => l && !/^(enable-rcon|rcon\.port|rcon\.password|broadcast-rcon-to-ops)=/.test(l)) : [];
  lines.push("enable-rcon=true", `rcon.port=${config.port}`, `rcon.password=${config.password}`, "broadcast-rcon-to-ops=false");
  writeFileSync(file, lines.join("\n") + "\n");
  return config;
}

const AUTH = 3;
const COMMAND = 2;

/** Minimal Source RCON client (the protocol Minecraft servers speak): log in once, then one reply per command. */
export class RconClient {
  private socket?: Socket;
  private buffer = Buffer.alloc(0);
  private waiting = new Map<number, (packet: { id: number; body: string }) => void>();
  private nextId = 10;

  static async open(config: RconConfig, timeoutMs = 10_000): Promise<RconClient> {
    const client = new RconClient();
    await client.connect(config, timeoutMs);
    return client;
  }

  private connect(config: RconConfig, timeoutMs: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const socket = connect(config.port, "127.0.0.1");
      const timer = setTimeout(() => (socket.destroy(), reject(new Error("RCON connection timed out"))), timeoutMs);
      socket.once("error", (e) => (clearTimeout(timer), reject(e)));
      socket.on("data", (data) => this.receive(data));
      socket.once("connect", async () => {
        this.socket = socket;
        const reply = await this.send(AUTH, config.password, timeoutMs);
        clearTimeout(timer);
        // A wrong password answers with id -1.
        if (reply.id === -1) {
          this.close();
          reject(new Error("RCON login refused"));
        }
        else resolve();
      });
    });
  }

  private receive(data: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, data]);
    while (this.buffer.length >= 4 && this.buffer.length >= this.buffer.readInt32LE(0) + 4) {
      const length = this.buffer.readInt32LE(0);
      const id = this.buffer.readInt32LE(4);
      const body = this.buffer.subarray(12, 4 + length - 2).toString("utf8");
      this.buffer = this.buffer.subarray(4 + length);
      // Login answers with the request id, or -1 for any pending request.
      const key = this.waiting.has(id) ? id : [...this.waiting.keys()][0];
      const done = this.waiting.get(key);
      this.waiting.delete(key);
      done?.({ id, body });
    }
  }

  private send(type: number, body: string, timeoutMs: number): Promise<{ id: number; body: string }> {
    const id = this.nextId++;
    const bytes = Buffer.from(body, "utf8");
    const packet = Buffer.alloc(14 + bytes.length);
    packet.writeInt32LE(10 + bytes.length, 0);
    packet.writeInt32LE(id, 4);
    packet.writeInt32LE(type, 8);
    bytes.copy(packet, 12);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => (this.waiting.delete(id), reject(new Error("RCON reply timed out"))), timeoutMs);
      this.waiting.set(id, (p) => (clearTimeout(timer), resolve(p)));
      this.socket!.write(packet);
    });
  }

  /** Runs a command (without the leading "/") and returns the server's reply text. */
  async command(command: string, timeoutMs = 30_000): Promise<string> {
    return (await this.send(COMMAND, command.replace(/^\//, ""), timeoutMs)).body;
  }

  close(): void {
    this.socket?.destroy();
    this.socket = undefined;
  }
}
