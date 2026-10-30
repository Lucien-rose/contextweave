class ContextWeaveError(Exception):
    pass


class ApiError(ContextWeaveError):
    def __init__(self, status: int, code: str, message: str,
                 request_id: str, issues: list[object] | None = None) -> None:
        super().__init__(message)
        self.status = status
        self.code = code
        self.request_id = request_id
        self.issues = issues


class TransportError(ContextWeaveError):
    def __init__(self, code: str) -> None:
        super().__init__(f"ContextWeave request failed: {code}")
        self.code = code
