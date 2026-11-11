# Logistics cleanup verification

The two overlapping unit matrices are consolidated in
`pharmatrace-vn-backend/src/modules/logistics/logistics-verification.spec.ts`.
Only tests of the same behavior at the same layer were removed. Database tests
remain separate from mocked service tests.

| Rule | Retained coverage |
| --- | --- |
| Source/destination visibility, dispatch/receipt sequence, tracking before pickup | Consolidated matrix and internal-transfer service tests |
| Blocked standalone cancellation, reroute, legacy COD and staff status delivery | Internal-transfer and shipment service tests; workflow DB suite |
| Failure reason and RMA requirement after delivery | Shipment service tests |
| Cancel requested transfers and release reservations; preserve dispatched custody | `order/helpers/order.helper.spec.ts`; workflow DB suite |
| Customer/admin order data consistency and cancellation/point refunds | Consolidated matrix; admin-order tests |
| Invalid/mismatched/reserved/duplicate UIDs, too few or too many UIDs | Consolidated matrix (`it.each` for quantity variants) |
| Halt/source return, counted destination discrepancy, UID loss | Consolidated matrix and both DB suites |
| Complete delivery proof and customer dispute ownership | Consolidated matrix (`it.each` for missing proof fields); workflow DB suite |
| Return intake enters quarantine without inventory resale, refund or payment write | Single retained intake case with all negative assertions; logistics DB suite |
| QA pass/fail and refund approval distinct from actual payment | Consolidated matrix and logistics DB suite |
| COD submission/approval and settled/discrepant outcomes | Consolidated matrix and both DB suites |
| Quote/fulfillment agreement and stale quote rejection | Consolidated matrix and workflow DB suite |
| Concurrent packing/cancellation, receipt, COD, QA, refund, replacement; rollback and RLS | Existing DB suites, retained in full |

DB receipt fixtures now model the existing handoff boundary: source on-hand and
reserved balances have been consumed, tracked boxes are in transit, and the
transfer has an outstanding custody row. They do not disable guards or RLS.
The source scan/dispatch test also reserves actual source stock.

Frontend regression checks:

```powershell
# Run from pharmatrace-vn-frontend
node --test src/hooks/useLogisticsList.test.mjs src/utils/shipment-query.test.mjs src/utils/cod-workflow.test.mjs
npx tsc --noEmit
```

These check filter serialization and local day boundaries, active-query refresh,
obsolete response/error suppression, COD access removal and loading/error state.
The shared filter component retains draft/apply/cancel behavior; shared audit
history retains actor identity, status, reason and occurrence/recording times.
