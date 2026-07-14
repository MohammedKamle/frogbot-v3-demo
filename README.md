# Frogbot Branch-Scanning Demo

An end-to-end demo of **JFrog Frogbot** scanning multiple Git branches,
**JFrog Xray** detecting vulnerable npm dependencies and raising policy
violations, and Frogbot automatically opening remediation pull requests.

**This demo runs on Frogbot v2 (`jfrog/frogbot@v2`), not v3.** It was
originally built on v3, but v3's scan-repository command consistently
returned zero findings on every branch/commit in this repo (`Couldn't
determine a package manager or build tool used by this project`), despite
`jf audit` against the exact same commit succeeding locally every time. See
[Appendix: why this demo uses v2 instead of v3](#appendix-why-this-demo-uses-v2-instead-of-v3)
for the full investigation — every plausible cause on our side (Config
Profile, SBOM-plugin version, branch naming, merge commits) was ruled out,
so this looks like an upstream v3 bug. v2 works correctly with this exact
repo content.

## Setup status: fully working end to end

Confirmed live at `github.com/MohammedKamle/frogbot-v3-demo`:

- ✅ 3 branches (`main` → `develop` → `feature`) pushed, each with its own
  vulnerable dependency set — see [Vulnerable dependencies](#vulnerable-dependencies).
- ✅ Xray indexing, Security Policy `frogbot-demo-critical-high-policy`, and
  Watch `frogbot-demo-npm-watch` live — see
  [Xray indexing, Policy, and Watch](#xray-indexing-policy-and-watch-created-for-this-demo).
- ✅ A dedicated 90-day JFrog access token minted for Frogbot's use rather
  than reusing a long-lived personal/admin token (`token_id`
  `1f0931a9-eff5-4430-b541-3f5e0a89b792`).
- ✅ `frogbot-scan-repository.yml` ran successfully on all 3 branches: Xray
  reported **16 Security Violations** tied to `frogbot-demo-npm-watch`
  (Critical/High CVEs against `handlebars`, `minimist`, `decode-uri-component`,
  `moment`, `lodash`), and Frogbot opened **one aggregated fix PR per branch**:
  [#1 → `develop`](../../pull/1), [#2 → `feature`](../../pull/2),
  [#3 → `main`](../../pull/3) — each bumping every fixable direct dependency
  in a single commit (`JF_GIT_AGGREGATE_FIXES: "TRUE"`).
- ✅ One extra one-time GitHub repo setting was required beyond the secrets:
  **Settings → Actions → General → Workflow permissions → "Allow GitHub
  Actions to create and approve pull requests"**. Without it, Frogbot builds
  the fix branch and pushes it, then fails at the last step
  (`403 GitHub Actions is not permitted to create or approve pull requests`).
  This was flipped via `gh api -X PUT repos/<owner>/<repo>/actions/permissions/workflow
  -f default_workflow_permissions=write -F can_approve_pull_request_reviews=true`.

See [How to reproduce](#how-to-reproduce) if you're setting this up fresh
against a different repo.

## Architecture

```
                    ┌─────────────────────────────────────────┐
                    │              GitHub repo                 │
                    │  branches: main / develop / feature       │
                    │  workflows: frogbot-scan-repository.yml   │
                    │             frogbot-scan-pull-request.yml │
                    └───────────────┬───────────────────────────┘
                                    │ push / schedule / PR
                                    ▼
                    ┌─────────────────────────────────────────┐
                    │        jfrog/frogbot@v2 GH Action        │
                    │  SCA scan of package.json/package-lock    │
                    └───────────────┬───────────────────────────┘
                                    │ reads CVE + fix-version data
                                    ▼
                    ┌─────────────────────────────────────────┐
                    │              JFrog Xray                   │
                    │  vulnerability DB · Security Policy       │
                    │  "frogbot-demo-critical-high-policy"      │
                    │  Watch "frogbot-demo-npm-watch" on        │
                    │  demo-npm-local + demo-npm-remote         │
                    └───────────────┬───────────────────────────┘
                                    │ resolves packages
                                    ▼
                    ┌─────────────────────────────────────────┐
                    │       Artifactory demo-npm (virtual)      │
                    │  = demo-npm-local + demo-npm-remote       │
                    │    (proxies registry.npmjs.org)           │
                    └─────────────────────────────────────────┘
```

- **Frogbot v2** is driven entirely by environment variables in the GitHub
  Actions workflow (no `frogbot-config.yml` needed for a single-repo setup
  like this one). `JF_WATCHES` ties its scan to the Security Policy created
  for this demo, and `JF_GIT_AGGREGATE_FIXES: "TRUE"` gives one PR per branch.
- **Xray** is wired independently of Frogbot via a repository-scoped Watch +
  Security Policy on `demo-npm`, so violations show up in the Xray UI whenever
  a vulnerable package is resolved/cached through that repo — this is the
  same mechanism you'd use for any Artifactory-backed repo, not something
  specific to Frogbot.

## Repository layout

```
.
├── package.json                       # dependencies vary per branch (see below)
├── package-lock.json
├── src/
│   ├── index.js                       # CLI greeting app (all branches)
│   ├── advanced.js                    # develop/feature only (ejs, qs, underscore)
│   └── i18n.js                        # feature only (y18n)
├── .npmrc.example                     # template for resolving through demo-npm
└── .github/workflows/
    ├── frogbot-scan-repository.yml    # scheduled + push scan, all 3 branches, opens fix PRs
    └── frogbot-scan-pull-request.yml  # scans every PR, comments with findings
```

## Vulnerable dependencies

All versions/severities below were confirmed live against this JFrog
instance's Xray vulnerability database (`POST /xray/api/v1/summary/component`)
and cross-checked with `npm audit` at setup time. Severities can shift as new
CVEs are researched — Xray is the source of truth at scan time, not this
table.

| Package | Vulnerable version | Fixed version | Xray severity | Introduced on |
|---|---|---|---|---|
| `minimist` | 1.2.5 | 1.2.6 | **Critical** (CVE-2021-44906, prototype pollution) | main |
| `handlebars` | 4.5.2 | 4.7.9 | **Critical** (CVE-2021-23383 and others, prototype pollution → RCE) | main |
| `lodash` | 4.17.15 | 4.18.1 | High (CVE-2021-23337 command injection) + Medium CVEs | main |
| `decode-uri-component` | 0.2.0 | 0.2.2 | High (CVE-2022-38900, DoS) | main |
| `moment` | 2.29.1 | 2.30.1 | High (CVE-2022-31129, ReDoS) | main |
| `node-fetch` | 2.6.0 | 2.7.0 | **Medium** (CVE-2022-0235, info exposure) | main |
| `ejs` | 3.1.5 | 3.1.10 | **Critical** (CVE-2022-29078, template injection RCE) | develop |
| `qs` | 6.9.6 | 6.15.3 | High (CVE-2022-24999, prototype pollution) | develop |
| `y18n` | 4.0.0 | 4.0.3 | High (CVE-2020-7774, prototype pollution) | feature |
| `underscore` | 1.12.0 | 1.13.8 | **Critical** (CVE-2021-23358, arbitrary code execution) | feature |

Branch composition (each branch accumulates the previous one's set, modeling
a realistic feature → develop → main flow):

| Branch | Package count | Critical | High | Medium |
|---|---|---|---|---|
| `main` | 6 | 2 | 3 | 1 |
| `develop` | 8 | 3 | 4 | 1 |
| `feature` | 10 | 4 | 5 | 1 |

Every package above has a real fixed version published to the public npm
registry (mirrored into `demo-npm` via `demo-npm-remote`), so Frogbot can
open a working remediation PR for each one.

## JFrog integration

### Dependency resolution — `demo-npm`

The project resolves npm dependencies through the **`demo-npm`** virtual
repository (composed of `demo-npm-local` + `demo-npm-remote`, which proxies
`registry.npmjs.org`). No JFrog hostname is hardcoded anywhere in this repo —
`.npmrc.example` uses npm's built-in `${VAR}` interpolation:

```
registry=${JFROG_URL}/artifactory/api/npm/demo-npm/
//${JFROG_NPM_REGISTRY_HOST}/artifactory/api/npm/demo-npm/:_authToken=${JFROG_TOKEN}
always-auth=true
```

Copy it to `.npmrc` locally (never commit a real `.npmrc`) or, in CI, generate
it with the JFrog CLI instead of writing secrets to disk yourself:

```bash
jf npm-config --repo-resolve=demo-npm
```

Frogbot v2 resolves dependencies from the public npm registry by default in
this demo (no `JF_DEPS_REPO` is set) — the same registry `demo-npm-remote`
proxies, so results are identical either way. Set `JF_DEPS_REPO: demo-npm`
in the workflow if you want Frogbot's own dependency resolution to go
through Artifactory too; the `demo-npm` wiring otherwise matters for real
developers building this project and for Xray's repository-level scanning
(see below).

### Xray indexing, Policy, and Watch (created for this demo)

Checked first via `GET /xray/api/v2/policies` and `/xray/api/v2/watches` —
none of the existing policies on this instance failed builds or created
violations scoped to Critical/High severities for an npm repo, so the
following were created:

1. **Enabled Xray indexing on `demo-npm-remote`** (`demo-npm-local` was
   already indexed; the remote's `-cache` was not).
   ```bash
   curl -X PUT "$JFROG_URL/xray/api/v1/binMgr/default/repos" \
     -H "Authorization: Bearer $JFROG_TOKEN" -H "Content-Type: application/json" \
     -d '{"indexed_repos": [...existing repos..., {"name":"demo-npm-remote","type":"remote","pkg_type":"npm"}]}'
   ```
2. **Security Policy** `frogbot-demo-critical-high-policy` — one rule,
   `min_severity: High` (matches High **and** Critical), actions:
   `create_ticket_enabled: true` + email notification. Deliberately **not**
   `block_download`, so vulnerable packages remain resolvable for Frogbot to
   scan and fix — a blocking policy would defeat the demo.
   ```bash
   curl -X POST "$JFROG_URL/xray/api/v2/policies" \
     -H "Authorization: Bearer $JFROG_TOKEN" -H "Content-Type: application/json" \
     -d @frogbot-demo-policy.json   # see xray/policy.json in this repo
   ```
3. **Watch** `frogbot-demo-npm-watch` — monitors both `demo-npm-local` and
   `demo-npm-remote`, assigned to the policy above.
   ```bash
   curl -X POST "$JFROG_URL/xray/api/v2/watches" \
     -H "Authorization: Bearer $JFROG_TOKEN" -H "Content-Type: application/json" \
     -d @frogbot-demo-watch.json    # see xray/watch.json in this repo
   ```

The exact JSON bodies used are saved in [`xray/policy.json`](xray/policy.json)
and [`xray/watch.json`](xray/watch.json) for reference/reproduction.

### Aggregated fix PRs — a plain env var in v2

Frogbot v2 supports `JF_GIT_AGGREGATE_FIXES: "TRUE"` directly as a GitHub
Actions env var (set in `frogbot-scan-repository.yml`), no platform-side
configuration required. With it set, each branch gets a single PR titled
`[🐸 Frogbot] Update npm dependencies` containing every fixable
vulnerability on that branch, instead of one PR per package. (This is the
opposite of Frogbot v3, where the same setting — `aggregate_fixes` — moved
into a JFrog Platform Config Profile with no write API; see the
[Appendix](#appendix-why-this-demo-uses-v2-instead-of-v3) for why v3 wasn't
used here.)

### Frogbot GitHub Actions configuration (v2)

Two workflows, based on the current v2 templates JFrog ships in the
[`jfrog/frogbot`](https://github.com/jfrog/frogbot) repository itself
(`.github/workflows/frogbot-scan-*.yml` at tag `v2.35.0`):

- **`frogbot-scan-pull-request.yml`** — triggers on every PR into
  `main`/`develop`/`feature`, scans the diff, and comments with findings
  (`pull-requests: write`).
- **`frogbot-scan-repository.yml`** — triggers on `push` to any of the three
  branches, on a daily schedule, and on manual dispatch. Uses a build matrix
  (`branch: [main, develop, feature]`) with `JF_GIT_BASE_BRANCH` so **all
  three branches are scanned independently on every run**, and
  `JF_GIT_AGGREGATE_FIXES: "TRUE"` so each branch gets one PR.

Both set `JF_WATCHES: "frogbot-demo-npm-watch"`, tying Frogbot's own
violation/severity reporting to the Security Policy created for this demo
(`min_severity: High`) rather than Frogbot's unfiltered default.

Both use `JF_GIT_TOKEN: ${{ secrets.GITHUB_TOKEN }}` — the token GitHub
auto-injects into every workflow run, scoped to this repo by the
`permissions:` block. No manual PAT is required to open PRs or post
comments. **Caveat:** PRs opened using the built-in `GITHUB_TOKEN` do not
themselves trigger other workflows (GitHub's loop-prevention). That's fine
here — the PR-scan workflow above triggers on `pull_request_target`
regardless of who opened the PR, including Frogbot's own fix PRs. If you
later want a separate CI/test workflow to also run automatically on
Frogbot's fix PRs, swap `JF_GIT_TOKEN` for a real PAT stored as a secret.

Both jobs run under a GitHub **Environment** named `frogbot` (created empty,
no protection rules, during setup) — this is the pattern JFrog recommends so
you can later add required reviewers before secrets are exposed to
PR-triggered workflows, which matters more once this repo accepts PRs from
forks.

## Required GitHub secrets

| Secret | Value | Notes |
|---|---|---|
| `FROGBOT_URL` | Your JFrog Platform URL | Same value as `$JFROG_URL` |
| `FROGBOT_ACCESS_TOKEN` | A JFrog access token | A dedicated 90-day token was minted for this demo (`access/api/v1/tokens`, description `frogbot-v3-branch-scan-demo-token`) rather than reusing a long-lived personal/admin token — rotate or revoke it independently when the demo is retired |

`JF_GIT_TOKEN` needs no secret — it uses the auto-provided `GITHUB_TOKEN`
(see above).

## How to reproduce

Full command history from this build, in order. Reuse this list if you're
setting the same demo up against a different repo/org.

```bash
# 1. Xray: checked for an existing policy that fails/violates on Critical+High
curl -s -H "Authorization: Bearer $JFROG_TOKEN" "$JFROG_URL/xray/api/v2/policies" | jq .
curl -s -H "Authorization: Bearer $JFROG_TOKEN" "$JFROG_URL/xray/api/v2/watches" | jq .
# -> none scoped appropriately, so:

# 2. Enabled Xray indexing on demo-npm-remote (demo-npm-local was already indexed)
curl -X PUT "$JFROG_URL/xray/api/v1/binMgr/default/repos" \
  -H "Authorization: Bearer $JFROG_TOKEN" -H "Content-Type: application/json" \
  --data @<merged-indexed-repos-payload>

# 3. Created the policy and watch
curl -X POST "$JFROG_URL/xray/api/v2/policies" -H "Authorization: Bearer $JFROG_TOKEN" \
  -H "Content-Type: application/json" -d @xray/policy.json
curl -X POST "$JFROG_URL/xray/api/v2/watches" -H "Authorization: Bearer $JFROG_TOKEN" \
  -H "Content-Type: application/json" -d @xray/watch.json

# 4. Minted a dedicated, time-limited access token for Frogbot to use
curl -X POST "$JFROG_URL/access/api/v1/tokens" -H "Authorization: Bearer $JFROG_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"scope":"applied-permissions/admin","expires_in":7776000,"description":"frogbot-v3-branch-scan-demo-token"}'

# 5. Local git repo: main -> develop -> feature, each adding its own vulnerable deps
git init -b main && git add -A && git commit -m "..."
git checkout -b develop && npm install ejs@3.1.5 qs@6.9.6 --save-exact && git commit -am "..."
git checkout -b feature && npm install y18n@4.0.0 underscore@1.12.0 --save-exact && git commit -am "..."

# 6. Created the GitHub repo and pushed all 3 branches
gh repo create <org-or-user>/<repo-name> --private --source=. --remote=origin
git push -u origin main develop feature

# 7. Added the required secrets (see "Required GitHub secrets" below)
gh secret set FROGBOT_URL --body "$JFROG_URL"
gh secret set FROGBOT_ACCESS_TOKEN < .frogbot-access-token.local

# 8. Created the "frogbot" GitHub Environment referenced by both workflows
gh api -X PUT "repos/<org-or-user>/<repo-name>/environments/frogbot"

# 9. First scan attempt (jfrog/frogbot@v3): zero findings on every branch/commit.
#    Ruled out Config Profile, SBOM-plugin version, master ref, merge commits
#    (see Appendix) - switched both workflows to jfrog/frogbot@v2.

# 10. Second attempt (v2): scan found everything correctly, but the final
#     "create pull request" step 403'd:
#       GitHub Actions is not permitted to create or approve pull requests.
#     Fixed with one GitHub repo setting, beyond the workflow's own
#     `permissions:` block:
gh api -X PUT "repos/<org-or-user>/<repo-name>/actions/permissions/workflow" \
  -f default_workflow_permissions=write \
  -F can_approve_pull_request_reviews=true
# (equivalently: Settings -> Actions -> General -> Workflow permissions ->
#  "Allow GitHub Actions to create and approve pull requests")

# 11. Re-ran and confirmed: 16 Xray violations, one aggregated fix PR per branch
gh workflow run frogbot-scan-repository.yml
gh run watch
gh pr list --state all

# 12. Open a PR (e.g. feature -> develop) to see the PR-scan workflow comment
gh pr create --base develop --head feature --title "Merge feature into develop" --body "Frogbot PR-scan demo"
```

## Expected Frogbot output

- **Repository scan** (`frogbot-scan-repository.yml`): one job per branch in
  the Actions run summary — `Scan Repository (main branch)`,
  `(develop branch)`, `(feature branch)` — each logging the CVEs found for
  that branch's dependency set, then opening **one aggregated pull request
  per branch** (branch name pattern `frogbot-update-<hash>-dependencies`)
  bumping every fixable dependency at once.
- **PR scan** (`frogbot-scan-pull-request.yml`): a markdown comment on the PR
  listing each vulnerable component and its CVE(s)/severity/fixed version.

## Confirmed Xray policy violations

`frogbot-scan-repository.yml`'s `main` branch job reported **16 Security
Violations** attributed to watch `frogbot-demo-npm-watch`, including
Critical/High CVEs against `handlebars` (multiple CVEs, e.g. CVE-2026-33937,
CVE-2021-23383/CVE-2021-23369), `minimist` (CVE-2021-44906 — flagged twice:
once as a direct dependency and once as the version `handlebars`'
`optimist`→`minimist` chain pulls in transitively), `decode-uri-component`
(CVE-2022-38900), and `moment` (CVE-2022-24785), each row showing the
Contextual Analysis result (`Applicable` / `Not Applicable` / `Missing
Context`) and fixed version(s). Same output is visible in the Xray UI under
**Watches & Policies → Violations**, filtered to `frogbot-demo-npm-watch`.
`develop`/`feature` report additional violations for their extra dependencies
(`ejs`, `qs`, `y18n`, `underscore`).

## Confirmed remediation pull requests

With `JF_GIT_AGGREGATE_FIXES: "TRUE"` set, Frogbot opened **one aggregated
PR per branch**, titled `[🐸 Frogbot] Update npm dependencies`:

| PR | Branch | Bumped |
|---|---|---|
| [#3](../../pull/3) | `main` | `moment` 2.29.1→2.29.4, `lodash` 4.17.15→4.18.0, `handlebars` 4.5.2→4.7.9, `decode-uri-component` 0.2.0→0.2.1 |
| [#1](../../pull/1) | `develop` | same as `main`, plus `ejs`/`qs` fixes |
| [#2](../../pull/2) | `feature` | same as `develop`, plus `y18n`/`underscore` fixes |

`minimist` (direct, 1.2.5) was **not** bumped on any branch — Frogbot's log
explains why: `minimist is an indirect dependency that will not be updated
to version 1.2.6. Fixing indirect dependencies can potentially cause
conflicts...`. This is Frogbot's own conflict-avoidance logic (it also
appears as a transitive dependency via `handlebars → optimist → minimist`,
at a different pinned version) — expected, documented behavior, not a bug.
Merging a PR resolves the corresponding CVEs on the next scan.

## Caveats

- This is a demo/POC setup, not a production hardening reference.
- Severities and available fixed versions were verified against this Xray
  instance and the public npm registry at setup time; they can change as new
  advisories are published — re-run the checks in "How to reproduce" step 3
  before relying on this table for anything beyond the demo.
- This demo runs on Frogbot v2, which JFrog has put into maintenance mode
  (critical bug/security fixes only) in favor of v3. See the Appendix below
  before assuming v2 is the long-term answer — it was the pragmatic choice
  to get a working demo, not necessarily what you should ship in production
  once the v3 issue is resolved upstream.

## Appendix: why this demo uses v2 instead of v3

This demo was originally built on Frogbot v3 (`jfrog/frogbot@v3`). Every
`scan-repository` run came back completely empty — all tables (`Vulnerable
Dependencies`, `Licenses`, `Secrets`, `IaC`, `SAST`) showed zero results, with
the log reading `Couldn't determine a package manager or build tool used by
this project` and `SBOM generated; no library components were found` in
under 50 microseconds. Meanwhile, cloning the exact commit Frogbot scanned
and running `jf audit` against it locally found every CVE in the
[Vulnerable dependencies](#vulnerable-dependencies) table correctly, every
time — proving the repo content itself was never the problem.

We ruled out, one at a time, across multiple live DEBUG-level runs:

1. **A stale/inherited Config Profile.** v3 replaces `frogbot-config.yml`
   with a JFrog Platform Config Profile matched by repo clone URL, following
   an SCM hierarchy (server → folder/user → repo). The first run picked up a
   profile from an unrelated, earlier demo under the same GitHub namespace.
   We created a fresh profile scoped specifically to this repo (via
   **Administration → Xray Settings → Indexed Resources → Git Repositories**
   → **Frogbot Configuration** drawer) — confirmed in the next run's log
   (`Using Config profile 'profile-frogbot-v3-demo-...'`, with
   `aggregate_fixes: true` correctly reflecting what we'd set). **Identical
   zero-result outcome.** Ruled out.
2. **The `.git/refs/heads/master` file-not-found error** appearing right
   before the SBOM step. Frogbot's own open-source clone code
   (`utils/git.go`) uses `SingleBranch: true, Depth: 1`, which means only the
   branch being scanned is ever fetched — so this ref would never exist
   regardless of what branches the remote has. We still tested it: pushed a
   `master` branch pointing at `main`. **Identical zero-result outcome.**
   Ruled out (and explained why: single-branch shallow clones never create
   refs for branches other than the one being cloned).
3. **The SBOM-plugin binary version** (`xray-scan-lib`, downloaded
   separately from Frogbot itself, currently defaulting to `1.4.0`). Found
   the override env var `JFROG_CLI_XRAY_LIB_PLUGIN_VERSION` in
   `jfrog-cli-security`'s source and tested the oldest available build,
   `1.0.4`. **Identical zero-result outcome.** Ruled out.
4. **Shallow clone of a merge commit.** `develop`/`feature`'s HEAD were merge
   commits (two parents) at the time of testing, while `main`'s HEAD is
   always a plain single-parent commit — a plausible split test. Checked the
   Xray UI's per-branch scan history for `main`: **zero CVEs there too**,
   across three different plain commits. Ruled out.

At this point every variable we could control from the repo/platform side
had been tested and produced the identical failure, while the local
`jf audit` control case succeeded every time — pointing to a bug in v3's
newer static-SBOM-plugin scan path (a closed-source binary, `xray-scan-plugin`,
invoked over RPC — not the open-source Go code in the `jfrog/frogbot` repo,
which never logs a "git clone" step for this scan mode at all, suggesting it
clones through some other mechanism internal to the plugin). Rather than
continue debugging a closed-source binary blind, we switched to Frogbot v2
(`jfrog/frogbot@v2`), which uses the older, non-plugin SCA path — the same
one `jf audit` uses — and **it worked immediately**: correct dependency
tree, 16 Xray violations, and (after also fixing the GitHub Actions
PR-creation permission — see [Setup status](#setup-status-fully-working-end-to-end))
one aggregated fix PR per branch, all confirmed live on this repo.

**If you hit this with your own v3 setup:** this is worth reporting to
JFrog's Frogbot team directly, with both full `JFROG_CLI_LOG_LEVEL: DEBUG`
logs (the "0 packages" run and the "aggregate_fixes: true, still 0 packages"
run) as reproduction evidence. It reproduced 100% of the time in this
environment, across 3 branches, 6+ commits, and 4 independent variables.
