# RDC Skill Test Suite Matrix

Current coverage: 29 manifests for 29 skill directories.

The manifest layer verifies each skill can be started from a realistic caller prompt in an isolated `RDC_TEST=1` sandbox. The acceptance harness records the engine stream, extracted tool calls, stdout/stderr artifacts, rendered assistant output, failures, lessons learned, and next build optimizations under `.rdc/reports/`.

`rdc:channel-formatter` currently has the strongest content acceptance fixture: it asserts source-grounded social-pack output, forbidden-claim absence, and observable corpus or web-search tool routing. `rdc:watch` adds a focus-safety negative check. The remaining manifests are basic behavioral smoke tests and should gain deeper acceptance assertions as each skill is touched.

| Skill | Manifest | Fixture prompt class | Assertions | Acceptance depth |
|---|---|---|---|---|
| `rdc:brochure` | `rdc-brochure.test.json` | HTML-to-PDF brochure fixture | `exit_code`, `stdout_contains` | Basic manifest |
| `rdc:build` | `rdc-build.test.json` | Unattended build from sandbox label | `commits_made`, `exit_code`, `stdout_contains` | Basic manifest |
| `rdc:channel-formatter` | `rdc-channel-formatter.test.json` | Long article to social content pack | `exit_code`, `stdout_contains` | Output contains, output not contains, tool-call routing |
| `rdc:co-develop` | `rdc-co-develop.test.json` | Coordination status | `commits_made`, `exit_code`, `stdout_contains` | Basic manifest |
| `rdc:collab` | `rdc-collab.test.json` | Claude session relay fixture | `commits_made`, `exit_code`, `stdout_contains` | Basic manifest |
| `rdc:convert` | `rdc-convert.test.json` | Markdown-to-Word conversion fixture | `exit_code`, `stdout_contains` | Basic manifest |
| `rdc:deploy` | `rdc-deploy.test.json` | Deployment diagnosis | `commits_made`, `exit_code`, `stdout_contains` | Basic manifest |
| `rdc:design` | `rdc-design.test.json` | Studio palette audit | `exit_code`, `stdout_contains` | Basic manifest |
| `rdc:fixit` | `rdc-fixit.test.json` | Tiny sandbox typo fix | `commits_made`, `exit_code`, `stdout_contains` | Basic manifest |
| `rdc:fs-mcp` | `rdc-fs-mcp.test.json` | File-system bridge read fixture | `commits_made`, `exit_code`, `stdout_contains` | Basic manifest |
| `rdc:handoff` | `rdc-handoff.test.json` | Stub work handoff | `exit_code`, `stdout_contains` | Basic manifest |
| `rdc:help` | `rdc-help.test.json` | Help menu rendering | `commits_made`, `exit_code`, `stdout_contains` | Basic manifest |
| `rdc:housekeeping` | `rdc-housekeeping.test.json` | Read-only housekeeping audit | `commits_made`, `exit_code`, `stdout_contains` | Basic manifest |
| `lifeai-brochure-author` | `rdc-lifeai-brochure-author.test.json` | JSX compliance review fixture | `exit_code`, `stdout_contains` | Basic manifest |
| `rdc:overnight` | `rdc-overnight.test.json` | Label-based overnight queue drain | `exit_code`, `stdout_contains` | Basic manifest |
| `rdc:plan` | `rdc-plan.test.json` | Health-endpoint planning prompt | `exit_code`, `stdout_contains` | Basic manifest |
| `rdc:preplan` | `rdc-preplan.test.json` | Rate-limiter research prompt | `commits_made`, `exit_code`, `stdout_contains` | Basic manifest |
| `rdc:prototype` | `rdc-prototype.test.json` | Tiny component prototype prompt | `exit_code`, `stdout_contains` | Basic manifest |
| `rdc:brochurify` | `rdc-rdc-brochurify.test.json` | Read-only markdown Brochurify fixture | `exit_code`, `stdout_contains` | Sandbox output and no-follow-up negative checks |
| `rdc:extract-verifier-rules` | `rdc-rdc-extract-verifier-rules.test.json` | Enhancement-log verifier fixture | `exit_code`, `stdout_contains` | Basic manifest |
| `rdc:release` | `rdc-release.test.json` | Dry-run package release | `commits_made`, `exit_code`, `stdout_contains` | Basic manifest |
| `rdc:report` | `rdc-report.test.json` | Unattended report generation | `exit_code`, `stdout_contains` | Basic manifest |
| `rdc:review` | `rdc-review.test.json` | Unattended review gate | `exit_code`, `stdout_contains` | Basic manifest |
| `rdc:rpms-filemap` | `rdc-rpms-filemap.test.json` | Canonical location lookup | `commits_made`, `exit_code`, `stdout_contains` | Basic manifest |
| `rdc:self-test` | `rdc-self-test.test.json` | Strict self-test prompt | `commits_made`, `exit_code`, `stdout_contains` | Basic manifest |
| `rdc:status` | `rdc-status.test.json` | Read-only status snapshot | `commits_made`, `exit_code`, `stdout_contains` | Basic manifest |
| `rdc:terminal-config` | `rdc-terminal-config.test.json` | Hidden-window launch policy audit | `commits_made`, `exit_code`, `stdout_contains` | Basic manifest |
| `rdc:watch` | `rdc-watch.test.json` | Watcher initialization prompt | `exit_code`, `stdout_contains` | Test-mode no-open output, tool-call routing, and focus-event negative checks |
| `rdc:workitems` | `rdc-workitems.test.json` | Work-item epic listing | `commits_made`, `exit_code`, `stdout_contains` | Basic manifest |

## What The Tests Accomplish

- Verify every installed RDC skill has at least one executable caller-facing prompt.
- Exercise the `RDC_TEST=1` sandbox contract so build tests do not publish, deploy, or mutate production services.
- Capture observed engine events and extracted tool calls for periodic inspection.
- Preserve stdout, stderr, and rendered assistant output as report artifacts.
- Make content-producing skills eligible for deeper source-fidelity checks through the optional `acceptance` block.

## Next Coverage Upgrades

- Add tool-call assertions to read/research skills (`rdc:preplan`, `rdc:fs-mcp`, `rdc:co-develop`, `rdc:collab`).
- Add artifact existence checks for output-producing skills (`rdc:brochure`, `rdc:convert`, `rdc:prototype`, `rdc:report`).
- Add negative safety assertions for skills that open windows, launch terminals, deploy, release, or write commits.
