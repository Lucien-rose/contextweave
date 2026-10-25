#!/usr/bin/env node
import { openVectorDatabase, printJson } from "./vector-cli.js";
import { runHealthCheck, healthStatus, healthRuns } from "../server/src/health/checks.js";
const { db } = openVectorDatabase();
try {
  const scope = process.argv[2] || "daily";
  printJson(scope === "status" ? healthStatus(db) : scope === "runs" ? healthRuns(db) : await runHealthCheck(db,{scope}));
} finally { db.close(); }
