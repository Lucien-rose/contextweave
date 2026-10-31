# Publication handoff

## Next candidate: Core 1.5.0 / SDKs 0.2.0

PR #16 prepares Recall Receipts. See [release notes](RELEASE_1.5.0.md).
These versions are not published. Existing PyPI 0.1.0 does not have the receipt reader.

After approval: merge the verified PR, confirm main-branch CI and Release Assets,
create GitHub release `v1.5.0` at that exact commit, and attach the source archive,
TypeScript tarball, Python wheel/sdist and SHA256SUMS from that run. Then manually
run Publish Python SDK against the same source revision for PyPI 0.2.0.
Keep the npm publication guard enabled. Private deployment is a separate upgrade.

Before a private upgrade, back up SQLite and configuration and adapt the changes
to the private package. Receipt storage adds a nullable `details_json` column.
Backend maintenance now clears completed receipts after 30 days and prepared
receipts after 90 days; review this retention change before deploying.

Core **1.4.0** is published at
https://github.com/Lucien-rose/contextweave/releases/tag/v1.4.0 with verified source,
TypeScript and Python SDK artifacts. Python SDK 0.1.0 is also published on
[PyPI](https://pypi.org/project/contextweave-sdk/0.1.0/); npm publication is
managed separately.

## Python SDK 0.1.0

The Python distribution is `contextweave-sdk`; the import package is
`contextweave_sdk`. The release workflow builds from the default branch, runs the
generated-contract, type, integration and independent-wheel tests, checks both
distribution archives, and publishes through PyPI Trusted Publishing. It stores no
PyPI password or long-lived API token.

The first trusted release completed successfully through the protected `pypi`
environment and the [Publish Python SDK workflow](https://github.com/Lucien-rose/contextweave/actions/runs/41054333979).
The trusted publisher remains configured with these values:

| Field | Value |
| --- | --- |
| PyPI project name | `contextweave-sdk` |
| GitHub owner | `Lucien-rose` |
| Repository | `contextweave` |
| Workflow | `publish-python.yml` |
| Environment | `pypi` |

Future releases use the same protected workflow. Its publish job requests short-lived
OIDC credentials; the repository stores no PyPI password or long-lived API token.

Verify the public package from a clean Python 3.11+ environment:

```sh
python -m venv /tmp/contextweave-pypi-verify
. /tmp/contextweave-pypi-verify/bin/activate
python -m pip install --upgrade pip
python -m pip install contextweave-sdk==0.1.0
python -c "from contextweave_sdk import ContextWeave, AsyncContextWeave; print('OK')"
```

A released version cannot be overwritten on PyPI. Future releases must increment
the SDK version before running the workflow again.

## npm follow-up

The TypeScript candidate remains `@contextweave/sdk`. Confirm ownership of the
`@contextweave` npm scope before removing its publication guard. Configure a
separate protected npm workflow after the account and scope are available.

Do not paste account credentials, recovery codes or tokens into source files,
release notes, workflow inputs or chat.
