#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { projectRecallForPublic } from "../server/src/public-projection.js";
import { progressiveRecall } from "../server/src/recall/progressive.js";
import { createDemoRepository } from "../demo/recall-repository.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fixture = JSON.parse(readFileSync(resolve(ROOT, "demo/fixtures/recall-core.json"), "utf8"));
if (fixture.dataset !== "synthetic") throw new Error("Public demo refuses non-synthetic data");
const result = await progressiveRecall(createDemoRepository(fixture.memories), {
  query: fixture.query, context: "private", intimacyMode: "off", shadowMode: "off", recordRecall: false,
});
const output = projectRecallForPublic({ route: result.trace.route,
  memories: result.memories.map((memory) => ({ ...memory, demo_synthetic: true })) },
  { synthetic: true, idSalt: "moss-demo-v1" });
process.stdout.write(`${JSON.stringify({ query: fixture.query, ...output }, null, 2)}\n`);
