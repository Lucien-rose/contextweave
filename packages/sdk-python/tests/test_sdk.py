import asyncio
import importlib.util
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
import zipfile

import httpx
from contextweave_sdk import AsyncContextWeave, ApiError, ContextWeave, ContextWeaveAdmin, TransportError

ROOT = Path(__file__).resolve().parents[3]
TOKEN = "synthetic-python-runtime-token"


def envelope(data, **meta):
    return {"api_version": "1", "data": data, "meta": {"request_id": "synthetic", **meta}}


class BackendTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.directory = tempfile.TemporaryDirectory(prefix="contextweave-python-")
        env = {**os.environ, "MOSS_VECTOR_ENV_FILE": "/dev/null", "MOSS_JEV_ENV_FILE": "/dev/null", "MOSS_JEV_API_KEY": ""}
        cls.server = subprocess.Popen(["node", str(Path(__file__).with_name("backend.js")), str(Path(cls.directory.name) / "db.sqlite")],
                                      cwd=ROOT, env=env, stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True)
        cls.base_url = f"http://127.0.0.1:{cls.server.stdout.readline().strip()}"

    @classmethod
    def tearDownClass(cls):
        cls.server.communicate(timeout=10)
        cls.directory.cleanup()

    def test_real_workflow_and_domain_states(self):
        spec = importlib.util.spec_from_file_location("example", ROOT / "examples/python/run.py")
        example = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(example)
        example.run_example(self.base_url, TOKEN)
        input = {"change_id": "python:create", "family_key": "python:harbor", "title": "Harbor launch",
                 "content": "Harbor launch is cobalt blue.", "source_refs": [{"source_type": "example", "source_id": "python:message"}]}
        with ContextWeave(base_url=self.base_url, token=TOKEN) as moss:
            self.assertEqual(moss.ingest(input)["data"]["status"], "review_required")
            input.update(authority="user_correction", user_instruction="Save this synthetic record.")
            saved = moss.ingest(input)["data"]
            self.assertEqual(saved["status"], "applied")
            self.assertTrue(moss.ingest(input)["data"]["replay"])
            with self.assertRaises(ApiError) as conflict:
                moss.ingest({**input, "content": "Different"})
            self.assertEqual(conflict.exception.status, 409)
            memory = moss.read({"memory_id": saved["memory_id"], "query": "Harbor launch"})["data"]
            edit = {**input, "change_id": "python:edit", "operation": "supersede", "lifecycle_class": "belief", "risk": "low",
                    "target_memory_id": saved["memory_id"], "content": "Harbor launch is forest green.",
                    "expected_content_hash": memory["content_hash"], "expected_updated_at": memory["updated_at"]}
            self.assertEqual(moss.evolve(edit)["data"]["status"], "applied")
            self.assertEqual(moss.evolve({**edit, "change_id": "python:stale"})["data"]["status"], "review_required")
            self.assertEqual(moss.change({"change_id": "python:edit"})["data"]["change_id"], "python:edit")
            self.assertFalse(moss.read({"memory_id": "python:sealed", "query": "Private agreement"})["data"]["available"])
            self.assertEqual(moss.bootstrap()["data"]["schema_version"], 3)
            with self.assertRaises(ApiError) as invalid:
                moss.recall({"query": "test", "typo": True})
            self.assertEqual(invalid.exception.status, 400)
            self.assertTrue(invalid.exception.issues)

    def test_roles_and_async_http_parity(self):
        with ContextWeaveAdmin(base_url=self.base_url, token=TOKEN) as moss:
            with self.assertRaises(ApiError) as denied:
                moss.reviews()
            self.assertEqual(denied.exception.status, 403)
        with ContextWeaveAdmin(base_url=self.base_url, token="synthetic-python-admin-token") as admin:
            self.assertIsInstance(admin.reviews()["data"]["reviews"], list)
        async def run():
            async with AsyncContextWeave(base_url=self.base_url, token=TOKEN) as moss:
                input = {"query": "No recall", "recall_control": {"mode": "no_recall"}}
                result = await moss.recall(input)
                async with httpx.AsyncClient(trust_env=False) as http:
                    raw = await http.post(f"{self.base_url}/api/v1/recall", json=input, headers={"Authorization": f"Bearer {TOKEN}"})
                self.assertEqual(result["data"], raw.json()["data"])
                self.assertEqual(result["data"]["route"], "NO_RECALL")
        asyncio.run(run())


class TransportTests(unittest.TestCase):
    def test_mount_meta_and_error_mapping(self):
        seen = []
        def handler(request):
            seen.append(request)
            return httpx.Response(200, json=envelope({}, recall_status={"mode": "off"}))
        with ContextWeave(base_url="https://example.test/moss", token=TOKEN, transport=httpx.MockTransport(handler)) as moss:
            self.assertEqual(moss.schema()["meta"]["recall_status"], {"mode": "off"})
        self.assertEqual(str(seen[0].url), "https://example.test/moss/api/v1/schema")
        self.assertEqual(seen[0].headers["Authorization"], f"Bearer {TOKEN}")
        for response in [httpx.Response(502, text="not JSON"), httpx.Response(200, json={"api_version": "2"}),
                         httpx.Response(302, headers={"Location": "https://other.test"})]:
            with ContextWeave(base_url="https://example.test", token=TOKEN, transport=httpx.MockTransport(lambda r: response)) as moss:
                with self.assertRaises(TransportError) as invalid:
                    moss.schema()
                self.assertEqual(invalid.exception.code, "invalid_response")

    def test_timeout_network_and_no_retries(self):
        for error, code in [(httpx.ReadTimeout("slow"), "timeout"), (httpx.ConnectError("offline"), "network")]:
            seen = []
            def handler(request):
                seen.append(request)
                raise error
            with ContextWeave(base_url="https://example.test", token=TOKEN, transport=httpx.MockTransport(handler)) as moss:
                with self.assertRaises(TransportError) as failed:
                    moss.schema(timeout=0.1)
                self.assertEqual(failed.exception.code, code)
                self.assertEqual(len(seen), 1)
                self.assertEqual(seen[0].extensions["timeout"]["read"], 0.1)

    def test_async_cancellation_propagates(self):
        async def run():
            started = asyncio.Event()
            async def handler(request):
                started.set()
                await asyncio.Event().wait()
            async with AsyncContextWeave(base_url="https://example.test", token=TOKEN, transport=httpx.MockTransport(handler)) as moss:
                task = asyncio.create_task(moss.schema())
                await started.wait()
                task.cancel()
                with self.assertRaises(asyncio.CancelledError):
                    await task
        asyncio.run(run())

    def test_independent_wheel_installation(self):
        with tempfile.TemporaryDirectory(prefix="contextweave-wheel-") as directory:
            package = ROOT / "packages/sdk-python"
            subprocess.run([sys.executable, "-m", "build", "--outdir", directory, str(package)], check=True, capture_output=True)
            wheel = next(Path(directory).glob("*.whl"))
            with zipfile.ZipFile(wheel) as archive:
                self.assertIn("contextweave_sdk/py.typed", archive.namelist())
                self.assertTrue(all(name.startswith(("contextweave_sdk/", "contextweave_sdk-")) for name in archive.namelist()))
            target = str(Path(directory) / "installed")
            subprocess.run([sys.executable, "-m", "pip", "install", "--no-deps", "--target", target, str(wheel)], check=True, capture_output=True)
            source = "import contextweave_sdk; from contextweave_sdk import ContextWeave, AsyncContextWeave; print(contextweave_sdk.__file__)"
            result = subprocess.check_output([sys.executable, "-c", source], cwd=directory, env={**os.environ, "PYTHONPATH": target}, text=True)
            self.assertIn(target, result)
