# Cursor Instructions: “How to Write a New Flow in Choco”

## Goal
Implement a **new Choco flow** using the existing **declarative flow engine** approach (Charidy-style), without adding product logic to the core engine/router.

## 1) Where to add things
- Flow definitions: `backend/src/lib/flowEngine/builtInFlows/*.ts`
- Tool executors: `backend/src/lib/flowEngine/tools/executors/*.ts`
- Tool registry: `backend/src/lib/flowEngine/tools/index.ts`
- Prompt markdown: follow project prompt folder convention (e.g. `.../prompts/<flowSlug>/*.md`)
- Notifications: templates + tools (email / WhatsApp)

## 2) Flow structure you must define
Each flow should include:
- `slug`, `name`, `type`
- `flowConfig`: `initialStage`, `successStage`, `errorStage`
- `fieldDefinitions`: typed fields (date/number/string/object/array)
- `stages`: a stage-by-stage state machine

## 3) Stage types (patterns)

### Prompt stage
Collect structured fields.
- `type: "prompt"`
- `prompt: "<path>.md"`
- `fields: [...]`
- `validation.required: [...]`
- `transitions: { next: "<stageSlug>" }`

### Action stage
Deterministic side-effects (API call, PDF generation, notifications).
- `type: "action"`
- `action.toolName: "choco.<domain>.<operation>"`
- `action.input: { ... }`
- `action.saveResults: { ... }`
- `action.onError: { behavior, message, nextStage? }`

### Prompt+Action stage
Collect one field then immediately call a tool (OTP is the classic example).

## 4) Data typing rules (hard requirements)
- Dates: ISO `YYYY-MM-DD` (date) or `YYYY-MM-DDTHH:MM:SSZ` (datetime)
- Amounts: numbers (limits, deductibles, premiums, sums insured)
- Logic/comments: store as `notes[]` and/or `rules_applied[]` (never inside numeric fields)
- Payment data: always **tokenize** (store `cc_token`, never raw PAN/CVV)

## 5) Handoffs between flows
Use declarative `onComplete` transitions:
```ts
config: { onComplete: { startFlowSlug: 'nextFlow', mode: 'seamless' } }
```

## 6) Gating / eligibility rules (business constraints)
When a feature is allowed **only under specific conditions**, implement it as an explicit gate in the flow (do not “wing it” in free-text).

### Example: Policy Existence Confirmation (COI)
- **Hard rule**: A COI can be issued **only** for an **existing customer** that has an **existing policy**.
- **Flow pattern**:
  - Authenticate (OTP) → check eligibility (customer exists + policy exists) using a deterministic tool/action stage
  - If eligible → generate + deliver the COI
  - If not eligible → handoff to registration / needs discovery → proceed to policy sale (never imply a COI was issued)

### Data collection focus (agent UX)
Keep the agent centered on:
- Customer identification: **first name, last name, mobile, email, address**
- Needs discovery for SMB + para-medical specialization
- Collecting the required underwriting data *based on discovered needs* (one question at a time)
