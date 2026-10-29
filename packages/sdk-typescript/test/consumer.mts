import { ContextWeave, ContextWeaveAdmin, ApiError } from "@contextweave/sdk";
const moss = new ContextWeave({ baseUrl: "http://localhost:2091", token: "synthetic" });
const input = {
  change_id: "example:create", family_key: "example:launch", title: "Launch",
  content: "Launch color is cobalt blue.", source_refs: [{ source_type: "example", source_id: "message:1" }],
};
async function consume() {
  const { data } = await moss.ingest(input);
  if (data.status === "review_required") {
    const id: string = data.review_id;
    // @ts-expect-error a pending review is not a saved memory
    data.memory_id;
  } else {
    const id: string = data.memory_id;
  }
  const memory = (await moss.read({ memory_id: "example", query: "launch" })).data;
  if (memory.available) {
    const hash: string = memory.content_hash;
  } else {
    // @ts-expect-error gated reads do not expose content
    memory.content;
  }
  await moss.bootstrap();
  await moss.recall({ query: "launch", context_envelope: { topics: ["launch"] } });
  // @ts-expect-error query is required
  await moss.recall({});
  // @ts-expect-error runtime surface does not expose admin methods
  await moss.reviews();
  // @ts-expect-error evolving requires version pins and full intent
  await moss.evolve(input);
  await new ContextWeaveAdmin({ baseUrl: "http://localhost", token: "admin" }).reviews();
  const error = new ApiError(403, "forbidden", "Admin required");
  const status: number = error.status;
}
void consume;
