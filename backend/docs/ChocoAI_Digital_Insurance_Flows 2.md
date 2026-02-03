# ChocoAI Digital Insurance Agent – Flow Documentation

This document describes the **Choco-specific flow implementations** for a **digital insurance agent**.
It is intentionally structured **exactly like the Charidy reference**, but adapted to the insurance domain and Choco business logic.

---

## Overview

ChocoAI uses the following flow structure (current default):

- **Entry Flow (router)**: `welcome` (**defaultForNewUsers: true**) — identifies customer vs returning lead
- **Customer Identification Flow**: `identifyCustomer`
- **Needs Discovery Flow**: `needsDiscovery`
- **Proposal Form Flow**: `proposalForm`
- **Carrier Submission Flow**: `carrierSubmission`
- **Underwriting Response Flow**: `underwritingReview`
- **Approval & Payment Flow**: `approvalAndPayment`
- **Issuance Flow**: `policyIssuance`
- **Notification Flow (mini-service)**: `notifications`

These flows demonstrate:
- Deterministic routing
- Insurance intake & underwriting orchestration
- Multi-step carrier interaction
- Payment + issuance lifecycle
- Post-issuance customer communication

---

## Flow: welcome (Entry Router)

**Slug**: `welcome`  
**Type**: Router Flow  
**Default Entry**: Yes (`defaultForNewUsers: true`)

### Purpose

Determines what the user wants to do:
- Start a new insurance process
- Continue an existing quote
- Identify as an existing insured
- Reach support

### Routing

`welcome.route` transitions to:
- `identifyCustomer` if customer identity is unknown
- `needsDiscovery` if identity exists and no active proposal
- `underwritingReview` if carrier questions are pending
- `notifications` if intent is support

---

## Flow: identifyCustomer (Customer Identification)

**Slug**: `identifyCustomer`  
**Type**: Service Flow  
**Default Entry**: No

### Purpose

Identifies the customer in a compliant, low-friction way.

### Key Behaviors

- OTP via SMS / Email
- Minimal PII collection
- Lookup of existing insured / leads

### Fields

- `first_name`
- `last_name`
- `phone`
- `email`
- `customer_id`
- `is_existing_customer`

### Completion

On success → `needsDiscovery`

---

## Flow: needsDiscovery (Needs Assessment)

**Slug**: `needsDiscovery`  
**Type**: Service Flow  
**Default Entry**: No

### Purpose

Understands the insurance need before any form is shown.

### Stages

**productSelection**
- Business insurance
- Para-medical professional liability
- Cyber insurance

**riskProfile**
- Business activity
- Turnover
- Employees
- Claims history
- Locations

**coveragePreferences**
- Required coverages
- Desired limits
- Deductible sensitivity

### Output

Sets:
- `product_line`
- `uw_risk_level`
- `required_form_schema`

### Transition

→ `proposalForm`

---

## Flow: proposalForm (Proposal / Application)

**Slug**: `proposalForm`  
**Type**: Onboarding Flow  
**Default Entry**: No

### Purpose

Collects a **formal insurance proposal** using schema-driven JSONB forms.

### Key Features

- Dynamic sections by product & risk
- Strong typing:
  - Dates → ISO date / datetime
  - Amounts → numbers
- Embedded logic & underwriting notes

### Output

- `proposal_raw`
- `proposal_normalized`
- `proposal_pdf`

### Completion

On customer confirmation → `carrierSubmission`

---

## Flow: carrierSubmission (Send to Insurance Company)

**Slug**: `carrierSubmission`  
**Type**: Service Flow  
**Default Entry**: No

### Purpose

Submits the proposal to one or more insurance carriers.

### Key Behaviors

- Carrier appetite routing
- Payload transformation
- Attachments (proposal PDF, declarations)

### Fields

- `carrier_submissions[]`
- `submission_status`

### Transition

→ `underwritingReview`

---

## Flow: underwritingReview (Carrier Response)

**Slug**: `underwritingReview`  
**Type**: Service Flow  
**Default Entry**: No

### Purpose

Handles carrier feedback:
- Price
- Draft policy
- Follow-up questions
- Exclusions / endorsements

### Possible Outcomes

- `quote_received`
- `draft_policy_received`
- `carrier_questions_pending`
- `declined`

### Routing

- Questions → back to customer (loop stays in this flow)
- Quote approved → `approvalAndPayment`

---

## Flow: approvalAndPayment (Customer Approval & Payment)

**Slug**: `approvalAndPayment`  
**Type**: Finalization Flow  
**Default Entry**: No

### Purpose

Completes the commercial agreement.

### Steps

1. Present quote / draft policy
2. Collect customer approval
3. Collect credit card details
4. Generate payment authorization PDF
5. Digital signature

### Output

- `payment_method`
- `credit_card_token`
- `signed_documents[]`

### Completion

→ `policyIssuance`

---

## Flow: policyIssuance (Policy Issued)

**Slug**: `policyIssuance`  
**Type**: Service Flow  
**Default Entry**: No

### Purpose

Final interaction with the insurance company.

### Actions

- Send signed proposal + CC authorization PDF
- Receive issued policy
- Store policy number & documents

### Fields

- `policy_number`
- `policy_documents[]`
- `policy_start_date`
- `policy_end_date`

### Completion

→ `notifications`

---

## Flow: notifications (Customer Notifications)

**Slug**: `notifications`  
**Type**: Mini-Service Flow  
**Default Entry**: No

### Purpose

Closes the loop with the customer.

### Notifications

- Email with policy PDF
- WhatsApp confirmation message
- Optional agent follow-up task

---

## Data Model

### Choco Core Fields

- `customer_id`
- `product_line`
- `proposal_normalized` (jsonb)
- `carrier_submissions[]`
- `quotes[]`
- `selected_quote`
- `payment`
- `policy`

### Shared Across Flows

- Identity fields
- Proposal data
- Carrier responses
- Payment status

---

## Customization Notes

- All flows are declarative
- No insurance logic in router/core engine
- Carriers integrated via tools
- Notifications via templates

The engine is domain-agnostic — Choco flows define the intelligence.
