#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { openVectorDatabase, printJson } from "./vector-cli.js";
import { beginVectorMigration, cancelVectorMigration, retirePreviousGeneration, switchVectorGeneration, vectorDeploymentStatus } from "../server/src/vector/deployment.js";
import { compareVectorGenerations, syncVectorIndex } from "../server/src/vector/migration.js";
const [operation = "status", file] = process.argv.slice(2);
const input = file ? JSON.parse(readFileSync(file,"utf8")) : {};
const { db } = openVectorDatabase();
try {
  const operations = {
    status: () => vectorDeploymentStatus(db), start: () => beginVectorMigration(db,input),
    sync: () => syncVectorIndex(db,input), compare: () => compareVectorGenerations(db,input),
    switch: () => switchVectorGeneration(db,input), rollback: () => switchVectorGeneration(db,{...input,rollback:true}),
    retire: () => retirePreviousGeneration(db,input.expected_revision),
    cancel: () => cancelVectorMigration(db,input.expected_revision),
  };
  if (!operations[operation]) throw new Error("Unknown vector migration operation");
  printJson(await operations[operation]());
} finally { db.close(); }
