import fs from "node:fs";
import path from "node:path";
/** Only the independent service owns a store. Prevent a second service from interrupting its jobs. */
export function lockStore(root: string) {
  fs.mkdirSync(root, { recursive: true });
  const file = path.join(root, "service.lock");
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fd = fs.openSync(file, "wx", 0o600);
      fs.writeFileSync(fd, String(process.pid));
      fs.closeSync(fd);
      const release = () => {
        try {
          if (fs.readFileSync(file, "utf8") === String(process.pid))
            fs.unlinkSync(file);
        } catch {}
      };
      process.once("exit", release);
      return release;
    } catch (e) {
      if ((e as any).code !== "EEXIST") throw e;
      const pid = Number(fs.readFileSync(file, "utf8"));
      let alive = true;
      if (pid > 0) {
        try {
          process.kill(pid, 0);
        } catch (err) {
          alive = (err as any).code !== "ESRCH";
        }
      } else alive = Date.now() - fs.statSync(file).mtimeMs < 10000;
      if (alive)
        throw Error(`保存先は別サービスが使用中です: ${root} (PID ${pid})`);
      fs.unlinkSync(file);
    }
  }
  throw Error("保存先のロックを取得できません");
}
