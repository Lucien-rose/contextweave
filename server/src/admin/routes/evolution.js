import { json, readJson } from "../http.js";
import { readDelegationPolicy, setDelegationPolicy } from "../../evolution/policy.js";
import { listChanges, readChange, undoChange } from "../../evolution/changes.js";
import { applyIntentWithMaintenance } from "../../memory-write.js";
import { readFamily, groupFamily } from "../../family/service.js";
import { proposeFamilyGroups } from "../../family/proposal.js";
import { judgeFamily } from "../../family/jev.js";
import { deleteMemory } from "../../evolution/deletion.js";
import { planMemoryRestore, restoreMemory } from "../../evolution/restore.js";
import { dismissReview, listReviews } from "../../evolution/reviews.js";
import { evolutionRetentionStatus } from "../../evolution/retention.js";
import { readFamilyHistory } from "../../family/history.js";

export function createEvolutionRoutes({ db }) {
  return async (req, res, url) => {
    const path = url.pathname;
    if (path === "/api/evolution/family/history" && req.method === "POST") {
      return json(res, 200, readFamilyHistory(db, await readJson(req)));
    }
    if (path === "/api/evolution/policy") {
      if (req.method === "GET") return json(res, 200, readDelegationPolicy(db));
      if (req.method === "PUT") return json(res, 200, setDelegationPolicy(db, await readJson(req)));
    }
    if (path === "/api/evolution/intent" && req.method === "POST") {
      return json(res, 200, await applyIntentWithMaintenance(db, await readJson(req)));
    }
    if (path === "/api/evolution/family" && req.method === "GET") {
      return json(res, 200, readFamily(db, { family_key: url.searchParams.get("family_key") }));
    }
    if (path === "/api/evolution/family" && req.method === "PUT") {
      return json(res, 200, groupFamily(db, await readJson(req)));
    }
    if (path === "/api/evolution/family/plan" && req.method === "POST") {
      return json(res, 200, proposeFamilyGroups(db, await readJson(req)));
    }
    if (path === "/api/evolution/family/judge" && req.method === "POST") {
      return json(res, 200, await judgeFamily(db, await readJson(req)));
    }
    if (path === "/api/evolution/delete" && req.method === "POST") {
      return json(res, 200, await deleteMemory(db, await readJson(req)));
    }
    if (path === "/api/evolution/restore-plan" && req.method === "GET") {
      return json(res, 200, planMemoryRestore(db, String(url.searchParams.get("memory_id") || "")));
    }
    if (path === "/api/evolution/restore" && req.method === "POST") {
      return json(res, 200, restoreMemory(db, await readJson(req)));
    }
    if (path === "/api/evolution/undo" && req.method === "POST") {
      return json(res, 200, undoChange(db, await readJson(req)));
    }
    if (path === "/api/evolution/changes" && req.method === "GET") {
      const id = url.searchParams.get("change_id");
      return json(res, 200, id ? { change: readChange(db, id, { detail: true }) }
        : { changes: listChanges(db, url.searchParams.get("family_key")) });
    }
    if (path === "/api/evolution/reviews" && req.method === "GET") {
      return json(res, 200, { reviews: listReviews(db, {
        includeClosed: url.searchParams.get("include_closed") === "true",
      }) });
    }
    if (path === "/api/evolution/reviews" && req.method === "DELETE") {
      const { family_key } = await readJson(req);
      return json(res, 200, dismissReview(db, String(family_key)));
    }
    if (path === "/api/evolution/retention" && req.method === "GET") {
      return json(res, 200, evolutionRetentionStatus(db));
    }
    return json(res, 404, { error: "Not found" });
  };
}
