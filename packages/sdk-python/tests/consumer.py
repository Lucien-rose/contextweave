from contextweave_sdk import AsyncContextWeave, ContextWeave
from contextweave_sdk.requests import IngestInput


def consume(moss: ContextWeave, input: IngestInput) -> None:
    result = moss.ingest(input)["data"]
    if result["status"] == "review_required":
        review_id: str = result["review_id"]
        result["memory_id"]  # type: ignore[typeddict-item]
    else:
        memory_id: str = result["memory_id"]
    memory = moss.read({"memory_id": "example", "query": "launch"})["data"]
    if memory["available"]:
        hash: str = memory["content_hash"]
        content: str = memory["content"]
    else:
        memory["content"]  # type: ignore[typeddict-item]
    moss.recall({})  # type: ignore[typeddict-item]
    moss.reviews()  # type: ignore[attr-defined]
    moss.evolve(input)  # type: ignore[arg-type]


async def consume_async(moss: AsyncContextWeave) -> str:
    return (await moss.recall({"query": "launch"}))["meta"]["request_id"]
