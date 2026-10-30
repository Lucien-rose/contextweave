import { ContextWeave } from "@contextweave/sdk";
const moss = new ContextWeave({ baseUrl: "http://localhost:2091", token: "synthetic" });
const result = moss.recall({ query: "launch" });
void result;
