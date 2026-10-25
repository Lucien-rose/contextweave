#!/usr/bin/env node
import { vectorRuntimeStatus } from "../server/src/vector-retrieval.js";
import { openVectorDatabase, printJson } from "./vector-cli.js";

const { db, dbPath } = openVectorDatabase();
try {
  const status = await vectorRuntimeStatus(db, { probe: true });
  printJson({ operation: "vector-status", database: dbPath, ...status });
} finally {
  db.close();
}
