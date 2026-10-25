#!/usr/bin/env node
import { mkdirSync, existsSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { randomBytes } from "node:crypto";
import { openDatabase } from "../server/src/database.js";
import { modelSettingsPaths } from "../server/src/models/settings.js";

process.env.MOSS_CONFIG_DIR ||= resolve("data/config");
const { keyPath, path } = modelSettingsPaths();
mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
mkdirSync(dirname(keyPath), { recursive: true, mode: 0o700 });
if (!existsSync(keyPath)) writeFileSync(keyPath, randomBytes(32).toString("hex") + "\n", { mode: 0o600, flag: "wx" });
const { db } = openDatabase();
db.close();
console.log("ContextWeave database and model-key storage initialized; existing settings retained.");
