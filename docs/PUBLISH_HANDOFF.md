# Publication handoff

Core **1.4.0** is published at
https://github.com/Lucien-rose/contextweave/releases/tag/v1.4.0 with verified source,
TypeScript and Python SDK artifacts. Registry publication is managed separately.

## Python SDK 0.1.0

The Python distribution is `contextweave-sdk`; the import package is
`contextweave_sdk`. The release workflow builds from the default branch, runs the
generated-contract, type, integration and independent-wheel tests, checks both
distribution archives, and publishes through PyPI Trusted Publishing. It stores no
PyPI password or long-lived API token.

Before the first run, create the GitHub environment and the pending PyPI publisher
with these exact values:

| Field | Value |
| --- | --- |
| PyPI project name | `contextweave-sdk` |
| GitHub owner | `Lucien-rose` |
| Repository | `contextweave` |
| Workflow | `publish-python.yml` |
| Environment | `pypi` |

Then run **Publish Python SDK** from GitHub Actions. The workflow requires the
`pypi` environment and requests OIDC only for the publish job. PyPI converts the
pending publisher into the project's trusted publisher after the first successful
upload.

Verify the public package from a clean Python 3.11+ environment:

```sh
python -m venv /tmp/contextweave-pypi-verify
. /tmp/contextweave-pypi-verify/bin/activate
python -m pip install --upgrade pip
python -m pip install contextweave-sdk==0.1.0
python -c "from contextweave import ContextWeave, AsyncContextWeave; print('OK')"
```

A released version cannot be overwritten on PyPI. Future releases must increment
the SDK version before running the workflow again.

## npm follow-up

The TypeScript candidate remains `@contextweave/sdk`. Confirm ownership of the
`@contextweave` npm scope before removing its publication guard. Configure a
separate protected npm workflow after the account and scope are available.

Do not paste account credentials, recovery codes or tokens into source files,
release notes, workflow inputs or chat.
