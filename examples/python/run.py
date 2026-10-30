import os
from uuid import uuid4

from contextweave_sdk import ContextWeave
from contextweave_sdk.requests import IngestInput


def run_example(base_url: str, token: str) -> str:
    marker = f"Harbor-{uuid4()}"
    input: IngestInput = {
        "change_id": marker, "family_key": marker, "title": marker,
        "content": f"{marker}: The launch color is cobalt blue.",
        "authority": "user_correction", "user_instruction": "Save this synthetic Python example record.",
        "attributes": {"sensitivity": "personal", "triggers": [marker]},
        "source_refs": [{"source_type": "example", "source_id": marker}],
    }
    with ContextWeave(base_url=base_url, token=token) as moss:
        saved = moss.ingest(input)["data"]
        assert saved["status"] == "applied", "A pending review is not a saved memory"
        recalled = moss.recall({"query": marker, "delivery_mode": "confirmed", "jev_mode": "off", "vector_mode": "off"})["data"]
        assert any(memory["id"] == saved["memory_id"] for memory in recalled["memories"])
        memory = moss.read({"memory_id": saved["memory_id"], "query": marker, "detail": "full"})["data"]
        assert memory["available"] and "cobalt blue" in memory["content"]
        # Real hosts acknowledge only after injection into model context succeeds.
        delivered = moss.acknowledge({"receipt_id": recalled["delivery"]["receipt_id"], "memory_ids": [saved["memory_id"]]})
        assert delivered["data"]["status"] == "delivered"
    print("PASS: Python SDK ingested, recalled, read and acknowledged a synthetic memory.")
    return saved["memory_id"]


if __name__ == "__main__":
    run_example(os.environ.get("MOSS_BASE_URL", "http://127.0.0.1:2091"), os.environ["MOSS_RUNTIME_TOKEN"])
