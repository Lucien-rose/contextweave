# Generated from HTTP API v1. Run npm run python:generate.
from ._transport import AsyncTransport, SyncTransport
from .requests import ReceiptInput, IngestInput, RecallInput, EvolveInput, ReadInput, BootstrapInput, DeliveredInput, ChangeInput
from .types import ApiResponse, WriteResult, RecallResult, ReadResult, BootstrapResult, DeliveryResult, ChangeReceipt, ReviewsResult, SchemaResult, RecallReceipt


class ContextWeave(SyncTransport):
    def ingest(self, input: IngestInput, *, timeout: float | None = None) -> ApiResponse[WriteResult]:
        return self._request("ingest", input, timeout=timeout)

    def recall(self, input: RecallInput, *, timeout: float | None = None) -> ApiResponse[RecallResult]:
        return self._request("recall", input, timeout=timeout)

    def evolve(self, input: EvolveInput, *, timeout: float | None = None) -> ApiResponse[WriteResult]:
        return self._request("evolve", input, timeout=timeout)

    def read(self, input: ReadInput, *, timeout: float | None = None) -> ApiResponse[ReadResult]:
        return self._request("read", input, timeout=timeout)

    def bootstrap(self, input: BootstrapInput | None = None, *, timeout: float | None = None) -> ApiResponse[BootstrapResult]:
        return self._request("bootstrap", {} if input is None else input, timeout=timeout)

    def acknowledge(self, input: DeliveredInput, *, timeout: float | None = None) -> ApiResponse[DeliveryResult]:
        return self._request("recall/delivered", input, timeout=timeout)

    def change(self, input: ChangeInput, *, timeout: float | None = None) -> ApiResponse[ChangeReceipt]:
        return self._request("changes/read", input, timeout=timeout)

    def schema(self, *, timeout: float | None = None) -> ApiResponse[SchemaResult]:
        return self._request("schema", timeout=timeout)


class ContextWeaveAdmin(ContextWeave):
    def receipt(self, input: ReceiptInput, *, timeout: float | None = None) -> ApiResponse[RecallReceipt]:
        return self._request("recall/receipt", input, timeout=timeout)

    def reviews(self, *, timeout: float | None = None) -> ApiResponse[ReviewsResult]:
        return self._request("admin/reviews", timeout=timeout)


class AsyncContextWeave(AsyncTransport):
    async def ingest(self, input: IngestInput, *, timeout: float | None = None) -> ApiResponse[WriteResult]:
        return await self._request("ingest", input, timeout=timeout)

    async def recall(self, input: RecallInput, *, timeout: float | None = None) -> ApiResponse[RecallResult]:
        return await self._request("recall", input, timeout=timeout)

    async def evolve(self, input: EvolveInput, *, timeout: float | None = None) -> ApiResponse[WriteResult]:
        return await self._request("evolve", input, timeout=timeout)

    async def read(self, input: ReadInput, *, timeout: float | None = None) -> ApiResponse[ReadResult]:
        return await self._request("read", input, timeout=timeout)

    async def bootstrap(self, input: BootstrapInput | None = None, *, timeout: float | None = None) -> ApiResponse[BootstrapResult]:
        return await self._request("bootstrap", {} if input is None else input, timeout=timeout)

    async def acknowledge(self, input: DeliveredInput, *, timeout: float | None = None) -> ApiResponse[DeliveryResult]:
        return await self._request("recall/delivered", input, timeout=timeout)

    async def change(self, input: ChangeInput, *, timeout: float | None = None) -> ApiResponse[ChangeReceipt]:
        return await self._request("changes/read", input, timeout=timeout)

    async def schema(self, *, timeout: float | None = None) -> ApiResponse[SchemaResult]:
        return await self._request("schema", timeout=timeout)


class AsyncContextWeaveAdmin(AsyncContextWeave):
    async def receipt(self, input: ReceiptInput, *, timeout: float | None = None) -> ApiResponse[RecallReceipt]:
        return await self._request("recall/receipt", input, timeout=timeout)

    async def reviews(self, *, timeout: float | None = None) -> ApiResponse[ReviewsResult]:
        return await self._request("admin/reviews", timeout=timeout)
