import { createHash, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
export const hash = (data: unknown) =>
  createHash("sha256").update(JSON.stringify(data)).digest("hex");
export async function json(file: string) {
  return JSON.parse(await fs.readFile(file, "utf8"));
}
export async function atomic(file: string, data: unknown) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = file + "." + randomUUID() + ".tmp";
  await fs.writeFile(tmp, JSON.stringify(data, null, 2));
  await fs.rename(tmp, file);
}
export async function run(
  cmd: string,
  args: string[],
  signal?: AbortSignal,
  timeout = 120000,
) {
  signal?.throwIfAborted();
  return new Promise<string>((resolve, reject) => {
    const child = spawn(cmd, args, {
      stdio: ["ignore", "pipe", "pipe"],
      signal,
    });
    let out = "",
      err = "";
    child.stdout.on("data", (d) => {
      out = (out + d).slice(-2000000);
    });
    child.stderr.on("data", (d) => {
      err = (err + d).slice(-12000);
    });
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(Error(`${cmd} がタイムアウトしました`));
    }, timeout);
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      code === 0
        ? resolve(out)
        : reject(Error(`${cmd} 失敗 (${code}): ${err}`));
    });
  });
}
