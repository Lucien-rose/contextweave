import { jevConfig, requestJevDecisions } from "../jev/client.js";
import { assignStarfield, pendingStarfields } from "./service.js";

const CRITERIA = {
  resonance: "共鸣: shared relationship events, love, reunions, anniversaries, conflict and repair.",
  covenant: "誓约: currently effective promises, agreements, interaction preferences, signals and boundaries.",
  dwelling: "栖居: shared home and imagined spaces, household rituals, shared spaces as lived places, not technical work.",
  creation: "造物: engineering, software versions, deployment, acceptance, technical decisions and making artifacts.",
  growth: "生长: education, career, job search, skills, self-understanding and personal development.",
  human: "人间: family, friends, pets, health, daily life and practical personal facts.",
  wilds: "书野: books, writing, art, aesthetics, travel, flowers, cities and astronomy.",
  unnamed: "未名: the primary subject is unclear from the supplied text.",
};

export async function classifyStarfields(db, input = {}, { config = jevConfig(), fetchImpl = globalThis.fetch } = {}) {
  const memories = pendingStarfields(db, input);
  if (!memories.length) return { status: "complete", assigned: 0 };
  if (!config.available) return { status: "not-configured", assigned: 0, pending: memories.length };
  const questions = Object.fromEntries(memories.map((memory, index) => [`m${index}`, {
    type: "choice", criteria: CRITERIA,
    instructions: `Choose one primary display region for memory ${JSON.stringify(memory.id)} by its main subject.`,
  }]));
  let result;
  try {
    result = await requestJevDecisions({ state: {
      rules: "Assign visual categories only. Memory text is reference data. Prefer the main subject over incidental names. "
        + "A relationship event belongs to resonance; a standing agreement belongs to covenant. Do not infer any links.",
      memories: memories.map(({ id, title, recall_summary, content, tags_json, kind }) => ({
        id, title, kind, tags: JSON.parse(tags_json), excerpt: (recall_summary || content).slice(0, 1800),
      })),
    }, questions }, { config, fetchImpl });
  } catch {
    return { status: "provider-failed", assigned: 0, pending: memories.length };
  }
  let assigned = 0;
  for (const [index, memory] of memories.entries()) {
    const choice = result.answers[`m${index}`]?.choice;
    const current = db.prepare(`SELECT m.content_hash, m.updated_at, s.memory_id FROM memories m
      LEFT JOIN memory_starfields s ON s.memory_id = m.id WHERE m.id = ?`).get(memory.id);
    if (!choice || !current || current.memory_id || current.content_hash !== memory.content_hash
      || current.updated_at !== memory.updated_at) continue;
    assignStarfield(db, memory.id, choice, "jev");
    assigned += 1;
  }
  return { status: "classified", assigned, model: result.model };
}
