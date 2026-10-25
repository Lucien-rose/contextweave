import { parseContract } from "../lib/contract.js";
import { portraitReadSchema } from "./contract.js";
import { applyPortraitChange } from "./store.js";
import { buildPortraitSeed, readPortrait } from "./read.js";
import { portraitHousekeeping } from "./lifecycle.js";

export function createPortraitCore(db) {
  return {
    read: (input) => readPortrait(db, input),
    update: (input) => applyPortraitChange(db, input),
    seed(input = {}) {
      const request = parseContract(portraitReadSchema, input);
      return buildPortraitSeed(db, request);
    },
    housekeeping: (input) => portraitHousekeeping(db, input),
  };
}
