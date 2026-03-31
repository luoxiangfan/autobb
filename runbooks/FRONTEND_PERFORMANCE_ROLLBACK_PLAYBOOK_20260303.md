# Frontend Performance Rollback Playbook (2026-03-03)

## One-click Rollback Template
1. Generate template:
   - `npm run perf:rollback:template`
2. Apply process-level rollback:
   - `FF_NAV_LINK=0 FF_DASHBOARD_DEFER=0 FF_CAMPAIGNS_PARALLEL=0 FF_OFFERS_INCREMENTAL_POLL=0 FF_OFFERS_SERVER_PAGING=0 FF_CAMPAIGNS_REQ_DEDUP=0 FF_CAMPAIGNS_SERVER_PAGING=0 FF_KPI_SHORT_TTL=0 npm run start`

## Full Rollback (including monitoring flags)
1. Generate template:
   - `npm run perf:rollback:all:template`
2. Apply template to runtime env and restart service.

## Drill Procedure
1. Run drill command:
   - `npm run perf:rollback:drill`
2. Verify:
   - Flag dependency check result.
   - Service startup with rollback env.
   - Smoke on dashboard/offers/campaigns/products.
3. Capture timestamps and owners.

## Drill Record
- Date:
- Executor:
- Trigger simulation:
- Applied env template:
- Smoke result:
- Rollback duration:
- Follow-up actions:
