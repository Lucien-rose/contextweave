import { createBackend } from "../../../server/src/backend.js";
import { writeMemory } from "../../../server/src/database.js";
const backend = createBackend({ databasePath: process.argv[2],
  runtimeToken: "synthetic-python-runtime-token", adminToken: "synthetic-python-admin-token" });
writeMemory(backend.db, { id: "python:sealed", title: "Private agreement", content: "Synthetic sealed text.",
  sensitivity: "intimate", scope: "private_relationship", egress_policy: "local_only" });
const server = backend.app.listen(0, "127.0.0.1", () => console.log(server.address().port));
process.stdin.resume();
process.stdin.on("end", () => server.close(async () => { await backend.close(); }));
