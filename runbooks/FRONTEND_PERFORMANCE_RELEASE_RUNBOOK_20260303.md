# Frontend Performance Release Runbook (2026-03-03)

## Scope
- Applies to the zero-regression frontend performance program.
- Covers one-shot full release (no gray rollout).

## Preflight (T-30 min)
1. Freeze related merges.
2. Run dependency and flag validation:
   - `npm run perf:flags:check`
3. Run core contract/regression tests:
   - `npm run test -- 'src/lib/feature-flags.test.ts' 'src/app/api/offers/route.test.ts' 'src/app/api/campaigns/performance/route.test.ts' 'src/app/api/dashboard/kpis/route.test.ts' 'src/app/api/monitoring/web-vitals/route.test.ts' 'src/app/api/monitoring/frontend-errors/route.test.ts'`
4. Build:
   - `npm run build`
5. Confirm release owner/oncall/rollback owner in the same chat thread.

## Release Window
1. Deploy once during low traffic.
2. Keep a single version serving traffic.
3. Do not change `FF_*` values during the first observation window unless rollback is triggered.

## Post-release Checks
1. T+15 min:
   - Core API success rate.
   - `/api/campaigns/performance` p95/p99.
   - Frontend error count and web-vitals trend (if monitoring flags are enabled).
2. T+1 hour:
   - Smoke: dashboard/offers/campaigns/products.
3. T+24 hour:
   - Publish first-day stability summary.

## Rollback Triggers
- KPI mismatch > 0.1%.
- Core write-chain error rate increase.
- Batch operation semantic drift.
- API p95 or error-rate threshold breach.

## Rollback Command
- Core rollback env template:
  - `npm run perf:rollback:template`
- Full rollback env template:
  - `npm run perf:rollback:all:template`

Reference: [FRONTEND_PERFORMANCE_ROLLBACK_PLAYBOOK_20260303.md](./FRONTEND_PERFORMANCE_ROLLBACK_PLAYBOOK_20260303.md)
