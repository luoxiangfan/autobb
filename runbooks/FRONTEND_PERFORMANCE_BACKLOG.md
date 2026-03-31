# Frontend Performance Backlog

## P0 (must-do)
1. Remove performance release flags after two stable iterations.
2. Add CI job for `npm run perf:flags:check` + core contract suite.
3. Add canary synthetic checks for dashboard/offers/campaigns/products.

## P1 (high value)
1. Add compatibility signal metrics for `/api/offers` unsupported-sort fallback.
2. Add E2E regression test for offers auto-fallback to compatibility mode.
3. Add release artifact export (flag snapshot + dependency result).

## P2 (next iteration)
1. Tighten budget for first-load JS on `/offers` to `<=120kB`.
2. Evaluate replacing polling with event-driven refresh for offers status.
3. Clean up stale performance flags and simplify fallback branches.
