# About this fork

This repository is a fork of [open-pencil/open-pencil](https://github.com/open-pencil/open-pencil). It gives our projects a design editor that we control. It is not specific to one project.

The fork carries as few changes as possible. Every change we carry costs work at every upstream release.

## Rules

1. **Upstream first.** Offer every fix or feature to upstream as a pull request. Carry a change here only if upstream refuses it, or while its upstream pull request is open.
2. **Nothing project-specific.** Component libraries, design tokens, export settings and agent skills for one project live in that project's repository. A change belongs here only if any project could use it.
3. **Extension before edit.** Use the MCP server, the CLI, `eval` with the plugin API, or the Vue SDK before you change core code.
4. **Every carried change is listed below**, with the reason and the upstream pull request.

## Branches and tags

| Ref | What it is |
| --- | --- |
| `master` | An exact mirror of upstream `master`. Never commit to it. The sync job updates it. |
| `patched` | The default branch. The latest upstream release we use, plus our carried changes. |
| `sync/<tag>` | A pull request branch that brings one upstream release into `patched`. |
| `<upstream tag>-jn.<n>` | A fixed build to pin, for example `v0.17.0-beta.2-jn.1`. Every push to `patched` makes a new one. |

Projects pin a `-jn.<n>` tag. They never follow a branch. A project moves to a newer tag when it is ready.

## How upstream releases come in

`.github/workflows/fork-sync.yml` runs every day at 05:17 UTC. You can also start it by hand from the Actions tab.

1. It copies upstream `master` to our `master`.
2. It finds the newest upstream release. The repository variable `TRACK_PRERELEASES` controls this. With `true`, beta releases count. With `false`, only full releases count.
3. If `patched` already contains that release, it stops.
4. If not, it merges the release tag into a `sync/<tag>` branch and opens a pull request to `patched`.
5. If the merge has conflicts, it opens an issue that names the files. Resolve them on a `sync/<tag>` branch by hand, then open the pull request yourself.
6. It turns off every upstream workflow in this fork, so only the `fork-*` workflows run here.

`.github/workflows/fork-check.yml` runs on every pull request to `patched`. It builds the packages, runs the upstream unit tests, and runs the CLI against the upstream `.pen` fixtures.

`.github/workflows/fork-tag.yml` runs on every push to `patched` and creates the next `-jn.<n>` tag.

**Merge sync pull requests with a merge commit.** This repository allows only merge commits. A squash merge would drop the upstream history, and the next sync would then conflict on every file.

The sync job needs the repository secret `FORK_SYNC_TOKEN`. That is a fine-grained personal access token for this repository only, with read and write access to Actions, Contents, Issues, Pull requests and Workflows. A token is necessary because the default `GITHUB_TOKEN` cannot push changes to workflow files, and upstream releases often change them. Pull requests opened with the default token also do not start `fork-check`.

## How to carry a change

1. Open the pull request upstream first.
2. If we need the change before upstream merges it, or upstream refuses it, branch from `patched` and open a pull request to `patched`.
3. Keep each change in its own commit, with a message that says what it does.
4. Add a row to the table below.
5. When upstream merges the change, the next sync brings it in. Remove the row, and resolve any conflict in favour of the upstream version.

To list every commit we carry on top of the upstream release:

```sh
git log --no-merges --oneline "$(git describe --tags --abbrev=0 --match 'v*' --exclude '*-jn.*')"..patched
```

## Carried changes

| Change | Why we carry it | Upstream pull request |
| --- | --- | --- |
| `FORK.md` and the `fork-*` workflows | They run this fork. Upstream does not need them. | Not offered |
| Backport of upstream #1794, which loads only the sets a page uses and keeps opening files in hidden tabs | The `open_file` fix below builds on it. Remove it at the first upstream release that has it. | [#1794](https://github.com/open-pencil/open-pencil/pull/1794), merged after v0.17.0-beta.2 |
| `open_file` answers once the first page is in place, and `nextFrame` stops waiting after 250 ms without a frame | On Linux, WebKitGTK says a window behind other windows is visible but draws no frames for it. `open_file` then waited for a frame until the MCP call timed out. The same fix is on branch `fix/open-file-reply-when-ready`, based on upstream `master`. | Not offered yet |

## Build from source

The build needs bun at the version in `package.json` (`packageManager`), and Rust through rustup. `packages/html-engine/rust-toolchain.toml` pins the Rust version and the `wasm32-unknown-unknown` target. rustup installs both on first use.

```sh
bun install --frozen-lockfile
bun run build:packages                # CLI and MCP server
node packages/cli/bin/openpencil.js --help
bunx vite build                       # web app for the desktop shell
bun tauri build --no-bundle --config '{"build":{"beforeBuildCommand":""}}'
```

The desktop build needs WebKitGTK 2.40 or later on Linux. The empty `beforeBuildCommand` skips upstream's lint step, which fails at v0.17.0-beta.2. On some Linux laptops with two GPUs, the app stops at the splash screen. Start it with `WEBKIT_DISABLE_DMABUF_RENDERER=1` to fix that.
