# Fixed Audit Prompt — Scientific Baseline

This file pins the configuration used for every comparable audit run. The whole
point of the benchmark is that **only the target repo changes between runs** —
never the instructions, the model, or the budgets. If you change any value here,
bump the `configId` so old and new results are never compared by accident.

## configId: `baseline-v1`

### Model
- provider: `deepseek`
- model: `deepseek-v4-flash` (the auditor default; do not override)
- thinking: disabled (set in `deepSeekChatModel.ts`)

### Discovery instructions
The discovery prompt is the constant `CONTRACT_DISCOVERY_INSTRUCTIONS` in
`src/contract/discoverContract.ts`. It is committed code, not retyped per run, so
two runs at the same git commit use byte-identical instructions. Record the git
commit hash of the auditor alongside every run (see `metrics.json`).

### Budgets (auditor defaults — do not pass overrides)
- maxTurns: 30 (discovery)
- correction rounds: 1
- correction turns: 20
- correction targets: 40

### What is held constant
- Same auditor git commit across a comparison set.
- Same target repo commit (record it).
- Same model + budgets + instructions above.
- Fresh graph each run (no `--reuse-graph`) unless the experiment is specifically
  about graph reuse.

### What is measured (per run, in metrics.json)
- `tokens.totalTokens / promptTokens / completionTokens` — real DeepSeek usage.
- `wallClockMs` — end-to-end time.
- `turns`, `toolCalls`, `reviewTurns`, `correctionTurns` — effort.
- `coverage.coveragePercent`, `unexplainedMeaningfulNodes` — the functionality signal.
- `acceptance` + `acceptanceFailures` — the verdict.

### Comparing runs
```
node --experimental-strip-types bench/compare.ts audit-results/<target>
```
emits a table of every run for that target, sorted by time, so token and time
variance across identical prompts is visible at a glance.
