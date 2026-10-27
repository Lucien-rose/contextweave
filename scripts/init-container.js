import { existsSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import "./init-backend.js";

const path = join(process.env.MOSS_CONFIG_DIR, "tokens.env");
if (!existsSync(path)) {
  const tokens = ["MOSS_ADMIN_TOKEN", "MOSS_RUNTIME_TOKEN"]
    .map(name => `${name}=${randomBytes(32).toString("hex")}`).join("\n");
  writeFileSync(path, `${tokens}\n`, { mode: 0o600, flag: "wx" });
  console.log("Separate admin/runtime credentials created in data/config/tokens.env.");
}
