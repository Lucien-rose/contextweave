#!/usr/bin/env node
import { rebuildVectorIndex } from "../server/src/vector-retrieval.js";
import { hasFlag, numberArg, openVectorDatabase, printJson } from "./vector-cli.js";

const argv = process.argv.slice(2);
const batchSize = numberArg(argv, "--batch-size", 32, { min: 1, max: 256 });
const recreate = !hasFlag(argv, "--keep-collection");
const { db, dbPath } = openVectorDatabase();
try {
  const result = await rebuildVectorIndex(db, { batchSize, recreate });
  printJson({ operation: "vector-rebuild", database: dbPath, recreate, ...result });
} finally {
  db.close();
}
