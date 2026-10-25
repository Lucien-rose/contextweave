#!/usr/bin/env node
import { syncVectorIndex, vectorRuntimeStatus } from "../server/src/vector-retrieval.js";
import { numberArg, openVectorDatabase, printJson } from "./vector-cli.js";

const argv = process.argv.slice(2);
const batchSize = numberArg(argv, "--batch-size", 32, { min: 1, max: 256 });
const maxBatches = numberArg(argv, "--max-batches", 16, { min: 1, max: 1000 });
const { db, dbPath } = openVectorDatabase();
try {
  const status = await vectorRuntimeStatus(db);
  if (!status.provider_available) {
    printJson({ operation: "vector-sync", database: dbPath, skipped: "provider-unavailable", ...status });
    process.exitCode = 0;
  } else {
    const result = await syncVectorIndex(db, { batchSize, maxBatches });
    printJson({ operation: "vector-sync", database: dbPath, ...result });
  }
} finally {
  db.close();
}
