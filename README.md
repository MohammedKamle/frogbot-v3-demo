# Frogbot v3 Branch-Scanning Demo

An end-to-end demo of **JFrog Frogbot v3** scanning multiple Git branches,
**JFrog Xray** detecting vulnerable npm dependencies and raising policy
violations, and Frogbot automatically opening remediation pull requests.

## Setup status

Already done in this working directory / on the JFrog Platform:

- ✅ Local git repo initialized with 3 branches (`main` → `develop` →
  `feature`, in that ancestry order) and vulnerable dependencies committed —
  see [Vulnerable dependencies](#vulnerable-dependencies).
- ✅ Xray indexing enabled on `demo-npm-remote`.
- ✅ Xray Security Policy `frogbot-demo-critical-high-policy` and Watch
  `frogbot-demo-npm-watch` created and live (see
  [Xray indexing, Policy, and Watch](#xray-indexing-policy-and-watch-created-for-this-demo)).
- ✅ A dedicated 90-day JFrog access token minted for Frogbot's use (`token_id`
  `1f0931a9-eff5-4430-b541-3f5e0a89b792`, description
  `frogbot-v3-branch-scan-demo-token`) — the raw value is in the
  git-ignored `.frogbot-access-token.local` file in this directory (not
  committed). Use it for the `FROGBOT_ACCESS_TOKEN` secret below, then delete
  the file.

Still needed from you (see [How to reproduce](#how-to-reproduce) for exact
commands):

- ⬜ Create the GitHub repo and push the three branches.
- ⬜ Add the `FROGBOT_URL` / `FROGBOT_ACCESS_TOKEN` repo secrets.
- ⬜ Create the `frogbot` GitHub Environment (recommended, not required).
- ⬜ Trigger the first scan and verify the results described in
  [Expected Frogbot output](#expected-frogbot-output).
- ⬜ **If you want one PR per branch instead of one PR per vulnerability**:
  after the first scan, enable `aggregate_fixes` on this repo's Config
  Profile in the JFrog Platform UI — see
  [Config Profile — required for a single aggregated fix PR](#config-profile--required-for-a-single-aggregated-fix-pr).
  This is a platform UI toggle, not a repo file, so it's not done yet and
  can't be automated from here.

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
                    │        jfrog/frogbot@v3 GH Action        │
                    │  static SCA scan of package.json/lock     │
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

- **Frogbot v3** is config-file-free: there is no `frogbot-config.yml`. All
  behavior is driven by environment variables in the GitHub Actions workflow
  and (optionally) a JFrog Platform **Config Profile**. This demo does not use
  a Config Profile — Frogbot falls back to its default scan behavior, which is
  sufficient to demonstrate PR comments, security findings, and fix PRs. See
  [Config Profile note](#config-profile-not-used-optional-enhancement) below.
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

Frogbot v3 itself does **not** need this — it performs a static analysis of
`package.json`/`package-lock.json` without invoking `npm install`. The
`demo-npm` wiring matters for real developers building this project and for
Xray's repository-level scanning (see below), not for Frogbot's scan.

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

### Config Profile — required for a single aggregated fix PR

Frogbot v3 replaces the old `frogbot-config.yml` with a **Config Profile**
object in the JFrog Platform, matched to your repository by its clone URL
(requires Xray ≥ 3.117.0; this instance runs 3.150.2). There is always a
profile in play — confirmed on this instance via
`POST /xray/api/v1/xsc/profile_repos` with our repo's clone URL: before the
repo has ever been scanned, it resolves to the platform-wide
`System_Default_Profile`, which has `aggregate_fixes: false`. **That default
is why Frogbot opens one PR per vulnerability instead of one PR per branch.**

To get a single PR with all fixes on a branch (for a human to review and
approve once), enable **`aggregate_fixes`** on the profile scoped to this
repo:

1. Push the repo and let the first `frogbot-scan-repository.yml` run
   complete at least once (see [How to reproduce](#how-to-reproduce)). This
   causes Xray to provision a repo-specific Config Profile — on this
   instance, two prior demos show up as auto-created profiles named
   `<git-host>-<timestamp>` (confirmed via `GET /xray/api/v1/xsc/profile`),
   so expect one named similarly for this repo, e.g. `github.com-<ts>`.
2. In the JFrog Platform UI, go to **Administration → Xray Settings →
   Indexed Resources → Git Repositories** tab, and click this repo's entry
   to open the **Frogbot Configuration** drawer.
3. Open the **Auto-Fix** tab and toggle **"Group all fixes into one PR"**
   (a.k.a. "Aggregate all dependency fixes into a single PR" — disabled by
   default) to **on**.
4. Re-run `frogbot-scan-repository.yml` (or wait for the next scheduled/push
   scan). Each branch now gets a single PR titled `[🐸 Frogbot] Update
   <N> dependencies`, containing every fixable vulnerability found on that
   branch, instead of one PR per package.

**Caveat:** this toggle is a JFrog Platform UI setting, not something wired
into this repo's workflow files or committed config — no public, documented
REST API for *writing* Config Profiles was found while building this demo
(the `jfrog-client-go` SDK Frogbot itself uses only exposes read endpoints:
`GET /xray/api/v1/xsc/profile`, `GET .../profile/{name}`,
`POST .../profile_repos` for read-by-URL). If your Xray version predates
Config Profiles (< 3.117.0) or you'd rather not touch platform-wide settings,
the alternative is `aggregateFixes` in the legacy `frogbot-config.yml`, which
is a Frogbot v2-only mechanism and isn't read by the `jfrog/frogbot@v3`
action used here.

### Frogbot v3 GitHub Actions configuration

Two workflows, matching the current templates JFrog ships in the
[`jfrog/frogbot`](https://github.com/jfrog/frogbot) repository itself
(`.github/workflows/frogbot-scan-*.yml` on its `main`/v3 branch):

- **`frogbot-scan-pull-request.yml`** — triggers on every PR into
  `main`/`develop`/`feature`, scans the diff, and comments with findings
  (`pull-requests: write`) plus uploads SARIF results to the Security tab
  (`security-events: write`).
- **`frogbot-scan-repository.yml`** — triggers on `push` to any of the three
  branches, on a daily schedule, and on manual dispatch. Uses a build matrix
  (`branch: [main, develop, feature]`) with `JF_GIT_BASE_BRANCH` so **all
  three branches are scanned independently on every run**. Opens a fix PR
  per fixable vulnerability (or one aggregated PR, per Frogbot's default).

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

The commands below are split into **what already ran** (for reference /
audit) and **what's left for you** to run from this directory.

### Already run (for reference — do not repeat)

```bash
# Xray: checked for an existing policy that fails/violates on Critical+High
curl -s -H "Authorization: Bearer $JFROG_TOKEN" "$JFROG_URL/xray/api/v2/policies" | jq .
curl -s -H "Authorization: Bearer $JFROG_TOKEN" "$JFROG_URL/xray/api/v2/watches" | jq .
# -> none scoped appropriately, so:

# Enabled Xray indexing on demo-npm-remote (demo-npm-local was already indexed)
curl -X PUT "$JFROG_URL/xray/api/v1/binMgr/default/repos" \
  -H "Authorization: Bearer $JFROG_TOKEN" -H "Content-Type: application/json" \
  --data @<merged-indexed-repos-payload>

# Created the policy and watch
curl -X POST "$JFROG_URL/xray/api/v2/policies" -H "Authorization: Bearer $JFROG_TOKEN" \
  -H "Content-Type: application/json" -d @xray/policy.json
curl -X POST "$JFROG_URL/xray/api/v2/watches" -H "Authorization: Bearer $JFROG_TOKEN" \
  -H "Content-Type: application/json" -d @xray/watch.json

# Minted a dedicated, time-limited access token for Frogbot to use
curl -X POST "$JFROG_URL/access/api/v1/tokens" -H "Authorization: Bearer $JFROG_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"scope":"applied-permissions/admin","expires_in":7776000,"description":"frogbot-v3-branch-scan-demo-token"}'

# Local git repo: main -> develop -> feature, each adding its own vulnerable deps
git init -b main && git add -A && git commit -m "..."
git checkout -b develop && npm install ejs@3.1.5 qs@6.9.6 --save-exact && git commit -am "..."
git checkout -b feature && npm install y18n@4.0.0 underscore@1.12.0 --save-exact && git commit -am "..."
```

### Left for you

```bash
# 1. Create the GitHub repo from this directory and push all 3 branches
cd /Users/mohammedk/scratch-work/scm-branch-scan-frogbot
gh repo create <org-or-user>/<repo-name> --private --source=. --remote=origin
git push -u origin main develop feature

# 2. Add the required secrets (see "Required GitHub secrets" below)
gh secret set FROGBOT_URL --body "$JFROG_URL"
gh secret set FROGBOT_ACCESS_TOKEN < .frogbot-access-token.local
rm .frogbot-access-token.local   # delete the local copy once it's in GitHub

# 3. (Recommended) create the "frogbot" GitHub Environment referenced by both workflows
gh api -X PUT "repos/<org-or-user>/<repo-name>/environments/frogbot"

# 4. Trigger the first scan (scans all 3 branches via the matrix in the workflow)
gh workflow run frogbot-scan-repository.yml
gh run watch   # follow it live; or check the Actions tab in the GitHub UI

# 5. Open a PR (e.g. feature -> develop) to see the PR-scan workflow comment
gh pr create --base develop --head feature --title "Merge feature into develop" --body "Frogbot PR-scan demo"
```

## Expected Frogbot output

- **Repository scan** (`frogbot-scan-repository.yml`): one job per branch in
  the Actions run summary — `Scan Repository (main branch)`,
  `(develop branch)`, `(feature branch)` — each logging the CVEs found for
  that branch's dependency set, then opening one pull request per fixable
  vulnerability (branch name pattern `frogbot-<package>-<hash>`, e.g.
  `frogbot-minimist-1a2b3c4d`) targeting the scanned branch.
- **PR scan** (`frogbot-scan-pull-request.yml`): a markdown comment on the PR
  listing each vulnerable component, its CVE(s)/severity, and the fixed
  version, plus a SARIF upload visible under the repo's **Security → Code
  scanning alerts** tab.

## Expected Xray policy violations

Once `demo-npm-remote` resolves any of the vulnerable packages above (e.g.
via `npm install` through `demo-npm`, or Frogbot/Xray indexing the cached
tarball), the Xray UI (**Watches & Policies → Violations**, filtered to watch
`frogbot-demo-npm-watch`) shows a Security violation per Critical/High CVE,
e.g. `minimist:1.2.5` against CVE-2021-44906, `handlebars:4.5.2` against
CVE-2021-23383/CVE-2021-23369, etc. Medium-severity CVEs (e.g. on
`node-fetch`) are recorded by Xray but do not match this policy's
`min_severity: High` rule, so they won't appear as violations here — they
still surface in Frogbot's own PR comments and repository scan findings,
which aren't limited by the Watch's severity floor.

## Expected remediation pull requests

By default (`aggregate_fixes: false`, the platform-wide `System_Default_Profile`),
Frogbot opens **one PR per fixable vulnerability**, each bumping a single
dependency in `package.json`/`package-lock.json` to the version Xray reports
as fixed (see the table above), titled `[🐸 Frogbot] Update version of
<package> to <version>`, targeting the branch that was scanned.

If you enable `aggregate_fixes` for this repo's Config Profile (see
[above](#config-profile--required-for-a-single-aggregated-fix-pr)), Frogbot
instead opens **one PR per branch** titled `[🐸 Frogbot] Update <N>
dependencies`, bumping every fixable dependency on that branch in a single
commit — the "one PR to review and approve" flow. Either way, merging the
PR(s) resolves the corresponding CVEs on the next scan.

## Troubleshooting: scan runs green with zero findings

**Symptom:** `frogbot-scan-repository.yml` finishes "successfully" but every
table is empty (`Couldn't determine a package manager or build tool used by
this project`, `SBOM generated; no library components were found`), no PR
comment appears, and no fix PRs are opened — even though the repo clearly has
a vulnerable `package.json`.

**Root cause, confirmed on this instance:** the log line `Using Config
profile '<name>'` tells you which JFrog Platform Config Profile Frogbot
picked up for this repo (see [Config
Profile](#config-profile--required-for-a-single-aggregated-fix-pr) above —
Config Profiles follow an SCM hierarchy, so a repo can inherit a *folder*- or
*user*-level profile instead of getting its own). If that name isn't
`System_Default_Profile` and isn't specific to this repo, Frogbot is reusing
a profile created for a **different, earlier project** under the same
GitHub namespace. We verified the repo content itself is fine — cloning the
exact scanned commit and running `jf audit` locally against it correctly
found every CVE in the [Vulnerable dependencies](#vulnerable-dependencies)
table — so an inherited profile with settings that don't suit this repo (or
a stale/mismatched module config) is the leading suspect for why Frogbot's
static SBOM step finds zero components in CI.

**Fix:**

1. In the JFrog Platform UI, go to **Administration → Xray Settings →
   Indexed Resources → Git Repositories**, find this repo's entry (it should
   now be listed since it's been scanned), and open its **Frogbot
   Configuration** drawer. Creating/saving a profile here scopes it to this
   *repository* specifically, which takes priority over any inherited
   folder/user-level profile.
2. Confirm SCA scanning is enabled and nothing pins a `technology` other
   than npm for this repo's module.
3. Re-run `frogbot-scan-repository.yml`.
4. Both workflows now set `JFROG_CLI_LOG_LEVEL: "DEBUG"` (bumped from
   `INFO`) — if the run is still empty after step 1–3, pull the DEBUG log
   for the technology-detection lines (search for `Detect`, `Descriptors`,
   or the SBOM-generation block) to see exactly what path/patterns it
   evaluated and why.

Two warnings later in the same log are downstream symptoms of this, not
separate bugs, and should clear up once findings are non-empty:
`failed to upload SBOM snapshot to GitHub: at least one manifest is
required` (no manifest was detected, so there's nothing to snapshot) and
`Code scanning is not enabled for this repository` (403) — that one is
independent and just needs **Settings → Security → Code security → Code
scanning** enabled on the GitHub repo (or GitHub Advanced Security, if
private) for the SARIF upload to succeed.

## Caveats

- This is a demo/POC setup, not a production hardening reference — see the
  `GITHUB_TOKEN` and Config Profile notes above for what's simplified.
- Severities and available fixed versions were verified against this Xray
  instance and the public npm registry at setup time; they can change as new
  advisories are published — re-run the checks in "How to reproduce" step 3
  before relying on this table for anything beyond the demo.
