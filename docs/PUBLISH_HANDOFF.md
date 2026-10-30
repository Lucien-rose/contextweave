# Publication handoff

Target: Core **1.4.0**, with TypeScript/Python **0.1.0 previews**. The next release
action is a GitHub Release; registry publication is a separate follow-up.

## GitHub Release

1. Confirm the `release/1.4.0` preparation PR is merged and the resulting main
   commit has successful CI, Container and Release Assets checks. Use that exact
   commit, even if main advances afterward.
2. Download the `contextweave-release-assets` artifact from Release Assets for
   that commit. Unzip it and verify the files against `SHA256SUMS`.
3. In Releases → Draft a new release, create `v1.4.0` targeting the verified commit.
   Title: `ContextWeave 1.4.0 — HTTP API v1 and SDK previews`.
4. Use `docs/RELEASE_1.4.0.md` as the release body, omitting its temporary publication
   status paragraph. Retain the explicit SDK-preview/registry-publication limits.
   Attach the source archive, TypeScript tarball, Python wheel/sdist and SHA256SUMS.
5. Publish the GitHub Release. Check its tag commit, body and downloadable assets.
   npm/PyPI publication and production deployment are not triggered by this step.

Repository: https://github.com/Lucien-rose/contextweave

## Rebuilding assets locally

Use a clean checkout of the verified commit with Node.js 24 and a Python virtual
environment. Install repository dependencies and `./packages/sdk-python[dev]`.
The commands in `.github/workflows/release-assets.yml` build exactly the same
files. Do not include node_modules, databases, local configuration or git history
in the source archive; `git archive` includes only tracked source.

The SDK tarball installs with `npm install /path/to/contextweave-sdk-0.1.0.tgz`.
The Python wheel installs with `python -m pip install /path/to/contextweave_sdk-0.1.0-py3-none-any.whl`.
The TypeScript npm scope is still provisional in package metadata.

## npm / PyPI follow-up

Before enabling registry publication, sign in to the intended npm and PyPI owner
accounts. Confirm control of the npm scope and availability/ownership of the Python
distribution name. Current candidates are `@contextweave/sdk` and `contextweave-sdk`;
the checked-in names do not establish registry ownership or reserve them.

If names change, update metadata, examples and consumer tests together and rebuild
both packages. Only then remove TypeScript's `private: true` and Python's
`Private :: Do Not Upload`, set npm public access for a scoped package, and publish
the verified artifacts using the registry's authenticated flow. Check fresh installs
from each registry before changing the READMEs to registry-install instructions.

Do not paste account credentials or tokens into release notes, source files or chat.
