from types import TracebackType
from typing import Self, TypeVar, cast

import httpx

from .errors import ApiError, TransportError
from .types import ApiResponse

T = TypeVar("T")


def _base_url(value: str, token: str, timeout: float) -> str:
    url = httpx.URL(value)
    if url.scheme not in ("http", "https") or not url.host or url.userinfo or url.query or url.fragment:
        raise ValueError("base_url must be an HTTP(S) URL without credentials, query or fragment")
    if not token.strip():
        raise ValueError("token is required")
    if timeout <= 0:
        raise ValueError("timeout must be positive seconds")
    return str(url).rstrip("/") + "/api/v1/"


def _decode(response: httpx.Response) -> ApiResponse[T]:
    try:
        payload = response.json()
    except ValueError as error:
        raise TransportError("invalid_response") from error
    if not isinstance(payload, dict) or payload.get("api_version") != "1":
        raise TransportError("invalid_response")
    meta = payload.get("meta")
    if not isinstance(meta, dict) or not isinstance(meta.get("request_id"), str):
        raise TransportError("invalid_response")
    if not response.is_success:
        failure = payload.get("error")
        if not isinstance(failure, dict) or not isinstance(failure.get("code"), str) or not isinstance(failure.get("message"), str):
            raise TransportError("invalid_response")
        raise ApiError(response.status_code, failure["code"], failure["message"], meta["request_id"], failure.get("issues"))
    if "data" not in payload:
        raise TransportError("invalid_response")
    return cast(ApiResponse[T], payload)


class SyncTransport:
    def __init__(self, *, base_url: str, token: str, timeout: float = 30,
                 transport: httpx.BaseTransport | None = None) -> None:
        self._http = httpx.Client(base_url=_base_url(base_url, token, timeout),
                                  headers={"Authorization": f"Bearer {token}"}, timeout=timeout,
                                  follow_redirects=False, trust_env=False, transport=transport)

    def _request(self, path: str, input: object = None, *, timeout: float | None = None) -> ApiResponse[T]:
        try:
            response = self._http.request("GET" if input is None else "POST", path, json=input,
                                          timeout=self._http.timeout if timeout is None else timeout)
        except httpx.TimeoutException as error:
            raise TransportError("timeout") from error
        except httpx.RequestError as error:
            raise TransportError("network") from error
        return _decode(response)

    def close(self) -> None:
        self._http.close()

    def __enter__(self) -> Self:
        return self

    def __exit__(self, exc_type: type[BaseException] | None, exc: BaseException | None,
                 traceback: TracebackType | None) -> None:
        self.close()


class AsyncTransport:
    def __init__(self, *, base_url: str, token: str, timeout: float = 30,
                 transport: httpx.AsyncBaseTransport | None = None) -> None:
        self._http = httpx.AsyncClient(base_url=_base_url(base_url, token, timeout),
                                       headers={"Authorization": f"Bearer {token}"}, timeout=timeout,
                                       follow_redirects=False, trust_env=False, transport=transport)

    async def _request(self, path: str, input: object = None, *, timeout: float | None = None) -> ApiResponse[T]:
        try:
            response = await self._http.request("GET" if input is None else "POST", path, json=input,
                                                timeout=self._http.timeout if timeout is None else timeout)
        except httpx.TimeoutException as error:
            raise TransportError("timeout") from error
        except httpx.RequestError as error:
            raise TransportError("network") from error
        return _decode(response)

    async def aclose(self) -> None:
        await self._http.aclose()

    async def __aenter__(self) -> Self:
        return self

    async def __aexit__(self, exc_type: type[BaseException] | None, exc: BaseException | None,
                        traceback: TracebackType | None) -> None:
        await self.aclose()
