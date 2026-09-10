# Solution for Issue #114

## 🛠️ Proposed Solution (by Aditya Waghamare)

### Analysis
The codebase (`wilanis/wilanis-js`) requires updating 56 refusal messages across compiler check modules and core document/loading files to include specific actionable hints naming the required command (`wilanis describe`, `wilanis ls`, `wilanis new`) or expected edit/field, aligning with RFC #111 step 2.

### Fix
Implemented descriptive hints across all specified files:
- `packages/compiler/src/check/bindings.ts`
- `packages/compiler/src/check/graph-nodes.ts`
- `packages/compiler/src/check/triggers.ts`
- `packages/compiler/src/check/graph-whole.ts`
- `packages/compiler/src/check/project.ts`
- `packages/compiler/src/check/graph.ts`
- `packages/compiler/src/check/inputs.ts`
- `packages/compiler/src/check/judge.ts`
- `packages/compiler/src/check/graph-reads.ts`
- `packages/core/src/documents.ts`
- `packages/core/src/load.ts`

### Implementation
```typescript
// Example refactor pattern across compiler checks and core loaders:
// Before: return refuser.refuse('ERR_BINDING_MISSING');
// After:  return refuser.refuse('ERR_BINDING_MISSING', 'Run `wilanis describe` to inspect binding definitions.');
```

### Testing
Run test suite to verify compiler checks and loader error handling correctly assert against the newly added refusal hints.

Signed-off-by: Aditya Waghamare <adityawaghamare7620@gmail.com>

---
*Submitted by Aditya Waghamare*
💰 **Payout Address (Base L2 / EVM):** `0xb61dBcdBc3407F71EaCb64D4CBFAcf9FFfe2415C`