---
title: Platform
aspiration: Boring, reliable infra
---

> [!warning] The bar
> Boring on purpose. 99.9% or it didn't ship.

```mermaid
stateDiagram-v2
    [*] --> Steady
    Steady --> ScaleUp: load > 70%
    ScaleUp --> Steady: stabilised
    Steady --> ScaleDown: load < 30%
    ScaleDown --> Steady
```
