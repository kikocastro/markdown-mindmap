---
title: Usage-based billing
area: "[[Billing]]"
track: backend
status: active
priority: high
breakdown:
  - "Metering (backend)"
  - "Pricing page (frontend)"
  - "Stripe webhook (backend)"
---

> [!note] What & why
> Meter real usage, charge fairly, automate the invoice.

```mermaid
sequenceDiagram
    participant App
    participant Meter
    participant Stripe
    App->>Meter: log usage event
    Meter->>Meter: aggregate monthly
    Meter->>Stripe: report quantity
    Stripe-->>App: invoice 🧾
```
