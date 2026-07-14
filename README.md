# Frogbot v3 Branch-Scanning Demo

An end-to-end demo of **JFrog Frogbot v3** scanning multiple Git branches,
**JFrog Xray** detecting vulnerable npm dependencies and raising policy
violations, and Frogbot automatically opening remediation pull requests.

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

### Config Profile (not used — optional enhancement)

Frogbot v3 replaces the old `frogbot-config.yml` with an optional **Config
Profile** object in the JFrog Platform, matched to your repository by its
clone URL (requires Xray ≥ 3.117.0; this instance runs 3.150.2, so it's
supported). Without a matching profile, Frogbot logs "Frogbot configurations
will be derived from environment variables only" and proceeds with sensible
defaults — which is what this demo relies on. If you want to customize
min-severity thresholds, fixable-only behavior, or aggregate-fix PRs beyond
Frogbot's defaults, create a Config Profile in the JFrog Platform UI and it
will be picked up automatically on the next scan — no workflow changes
needed.

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

```bash
# 1. Scaffold the project
mkdir my-frogbot-demo && cd my-frogbot-demo
npm init -y
npm install minimist@1.2.5 handlebars@4.5.2 lodash@4.17.15 \
  decode-uri-component@0.2.0 moment@2.29.1 node-fetch@2.6.0

# 2. Create the GitHub repo and branches
gh repo create <org>/<repo> --private --source=. --push
git checkout -b develop && npm install ejs@3.1.5 qs@6.9.6 && git commit -am "develop: add ejs, qs"
git checkout -b feature && npm install y18n@4.0.0 underscore@1.12.0 && git commit -am "feature: add y18n, underscore"
git push -u origin develop feature

# 3. Check for an existing Xray policy that fails/violates on Critical+High
curl -s -H "Authorization: Bearer $JFROG_TOKEN" "$JFROG_URL/xray/api/v2/policies" | jq .
# none found scoped appropriately -> create one (see xray/policy.json, xray/watch.json)
curl -X POST "$JFROG_URL/xray/api/v2/policies" -H "Authorization: Bearer $JFROG_TOKEN" \
  -H "Content-Type: application/json" -d @xray/policy.json
curl -X POST "$JFROG_URL/xray/api/v2/watches" -H "Authorization: Bearer $JFROG_TOKEN" \
  -H "Content-Type: application/json" -d @xray/watch.json

# 4. Add the Frogbot v3 workflows (see .github/workflows/) and push

# 5. Add repo secrets
gh secret set FROGBOT_URL --body "$JFROG_URL"
gh secret set FROGBOT_ACCESS_TOKEN --body "<minted-token>"

# 6. Trigger a scan
gh workflow run frogbot-scan-repository.yml
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

For each fixable vulnerability, Frogbot opens a PR that bumps the single
dependency in `package.json`/`package-lock.json` to the version Xray reports
as fixed (see the table above), titled `[🐸 Frogbot] Update version of
<package> to <version>`, targeting the branch that was scanned. Merging it
resolves that CVE on the next scan.

## Caveats

- This is a demo/POC setup, not a production hardening reference — see the
  `GITHUB_TOKEN` and Config Profile notes above for what's simplified.
- Severities and available fixed versions were verified against this Xray
  instance and the public npm registry at setup time; they can change as new
  advisories are published — re-run the checks in "How to reproduce" step 3
  before relying on this table for anything beyond the demo.
