# AI PRODUCT SOURCING & MARKETPLACE ARBITRAGE INTELLIGENCE ENGINE
## MASTER AUDIT, VERIFICATION, REMEDIATION & PRODUCTION CERTIFICATION SPECIFICATION

**Version:** 3.0  
**Date:** August 2026  
**Status:** AUTHORITATIVE AUDIT SPECIFICATION  
**Source of Truth:** `IDEA.md` + actual repository implementation  
**Purpose:** Independent, evidence-first verification of implementation against `IDEA.md`  
**Certification Standard:** Production-grade / Financial-integrity / Security-first / Failure-resilient / Evidence-backed

---

# 0. DOCUMENT AUTHORITY

This document defines the mandatory procedure for auditing the repository implementing `IDEA.md`.

`IDEA.md` defines:

- WHAT the system must do
- WHAT capabilities must exist
- WHAT business rules must hold
- WHAT intelligence engines are required
- WHAT financial invariants must hold
- WHAT operational guarantees are required

This document defines:

- HOW those requirements are verified
- HOW evidence is collected
- HOW failures are classified
- HOW tests are executed
- HOW financial correctness is validated
- HOW intelligence quality is evaluated
- HOW security is verified
- HOW production readiness is determined

The audit MUST NOT reinterpret the product objective downward merely because implementation is incomplete.

If `IDEA.md` requires a capability and the capability does not exist:

`MISSING CAPABILITY`

is the correct result.

It MUST NOT be reported as:

`PASS`

because the rest of the application compiles.

---

# 1. CORE AUDIT PRINCIPLES

The auditor MUST follow these principles.

## 1.1 Evidence First

Every PASS claim MUST have executable or inspectable evidence.

Acceptable evidence includes:

- source code
- unit tests
- integration tests
- E2E tests
- property-based tests
- adversarial tests
- database evidence
- runtime evidence
- benchmark results
- logs
- metrics
- configuration evidence
- API responses
- state-transition evidence
- model evaluation evidence
- reproducible command output

Statements such as:

- "implemented"
- "should work"
- "looks correct"
- "covered by architecture"
- "future-ready"
- "designed for"
- "not needed yet"

are NOT evidence.

---

# 2. NO FABRICATED VERIFICATION

The auditor MUST NEVER fabricate:

- test counts
- test results
- build results
- benchmark results
- coverage percentages
- security results
- database results
- API results
- model accuracy
- supplier data
- marketplace data
- profit calculations
- opportunity counts
- EV calculations
- production-readiness status

If a verification was not actually executed:

`NOT_TESTED`

If evidence is insufficient:

`UNKNOWN`

If implementation is absent:

`MISSING`

If implementation exists but does not satisfy the requirement:

`FAIL`

If requirement is satisfied and evidence is sufficient:

`PASS`

---

# 3. AUDIT STATUS VOCABULARY

Every requirement MUST use one of the following statuses.

| Status | Meaning |
|---|---|
| PASS | Requirement implemented and independently verified |
| PASS_WITH_LIMITATION | Requirement substantially satisfied but material limitation remains |
| FAIL | Requirement implemented incorrectly |
| MISSING | Required capability does not exist |
| PARTIAL | Some required functionality exists but incomplete |
| UNKNOWN | Evidence insufficient |
| NOT_TESTED | Required verification was not executed |
| DEFERRED | Explicitly deferred, but still unresolved |
| NOT_APPLICABLE | Requirement genuinely does not apply |

`DEFERRED` MUST NOT be treated as PASS.

`UNKNOWN` MUST NOT be treated as PASS.

`NOT_TESTED` MUST NOT be treated as PASS.

---

# 4. AUDIT OBJECTIVES

The audit MUST independently establish whether the repository satisfies:

1. Specification compliance
2. Core sourcing capability
3. Supplier authenticity
4. Product/entity resolution
5. Marketplace intelligence
6. Market clearing price calculation
7. Landed-cost calculation
8. Profit correctness
9. Demand intelligence
10. Competition intelligence
11. Risk intelligence
12. Expected Value calculation
13. Scenario analysis
14. Sensitivity analysis
15. Opportunity scoring
16. Opportunity lifecycle
17. Opportunity decay
18. Collapse detection
19. Test-order decision
20. Scale decision
21. Stop-loss logic
22. Realized-profit attribution
23. Learning loop
24. Model evaluation
25. Model calibration
26. Data lineage
27. Data freshness
28. Security
29. SSRF resistance
30. Secret management
31. Authentication / authorization
32. Database integrity
33. Concurrency correctness
34. Retry behavior
35. Circuit breaker
36. Queue / DLQ behavior
37. Idempotency
38. Observability
39. Performance
40. API/interface contracts
41. Telegram interface
42. Regression safety
43. Deployment readiness
44. Production certification

---

# 5. AUDIT EXECUTION RULE

The auditor MUST NOT modify production implementation before completing the baseline audit.

Correct sequence:

```text
REPOSITORY DISCOVERY
        ↓
BASELINE AUDIT
        ↓
FINDINGS
        ↓
REMEDIATION PLAN
        ↓
IMPLEMENTATION
        ↓
TESTING
        ↓
FRESH RE-AUDIT
        ↓
PRODUCTION GATE
````

If remediation is required, the original finding MUST remain traceable.

---

# 6. REPOSITORY BASELINE

Record:

* repository path
* branch if available
* commit hash if available
* working tree status
* package manager
* Node/runtime version
* database version
* environment configuration
* build configuration
* test configuration
* deployment configuration

If Git does not exist:

```text
Git repository: NONE
Working tree: SOURCE OF TRUTH
```

Do NOT invent commit hashes.

---

# 7. SOURCE-OF-TRUTH HIERARCHY

When determining requirements, use:

```text
1. IDEA.md
2. AUDIT.md
3. Explicit architectural contracts
4. Database/schema contracts
5. API/interface contracts
6. Actual implementation
7. Tests
```

Tests MUST NOT redefine the specification.

If tests disagree with `IDEA.md`, report:

`SPECIFICATION / TEST MISMATCH`

Do not silently modify the requirement to make the test pass.

---

# 8. MANDATORY TRACEABILITY MATRIX

Every mandatory requirement from `IDEA.md` MUST be mapped to:

```text
IDEA requirement
        ↓
Implementation
        ↓
Unit test
        ↓
Integration test
        ↓
E2E test
        ↓
Adversarial test
        ↓
Runtime evidence
        ↓
Audit result
```

Minimum fields:

| ID | Requirement | Implementation | Tests | Evidence | Status | Severity |
| -- | ----------- | -------------- | ----- | -------- | ------ | -------- |

A requirement with no implementation MUST be `MISSING`.

A requirement with implementation but no meaningful verification MUST NOT receive unconditional PASS.

---

# 9. REQUIREMENT CLASSIFICATION

Every finding MUST be classified as one or more of:

* BUG
* MISSING_CAPABILITY
* ARCHITECTURAL_GAP
* SPECIFICATION_VIOLATION
* FINANCIAL_INTEGRITY_VIOLATION
* DATA_INTEGRITY_VIOLATION
* SECURITY_VULNERABILITY
* RELIABILITY_GAP
* PERFORMANCE_GAP
* OBSERVABILITY_GAP
* TESTING_GAP
* MODEL_GOVERNANCE_GAP
* DEPLOYMENT_GAP

---

# 10. SEVERITY MODEL

## P0 — Critical

Examples:

* fabricated financial data
* fabricated supplier price
* UNKNOWN interpreted as ZERO
* incorrect profit calculation
* security secret exposure
* authentication bypass
* critical data corruption
* production path incapable of fulfilling mandatory business objective
* mandatory financial invariant violation

## P1 — High

Examples:

* missing core intelligence engine
* market clearing price missing
* supplier verification incomplete
* EV engine incorrect
* demand engine materially incorrect
* competition engine materially incorrect
* lifecycle integrity failure
* critical resilience failure
* material model calibration failure

## P2 — Medium

Examples:

* incomplete observability
* incomplete test coverage
* missing non-critical automation
* moderate performance degradation
* incomplete operational tooling

## P3 — Low

Examples:

* documentation
* minor code quality
* cosmetic issues
* non-critical developer ergonomics

---

# 11. CORE BUSINESS CAPABILITY GATE

The following are mandatory business capabilities.

They MUST NOT be considered optional because they are absent from the current implementation.

Required:

```text
Supplier Sourcing
Supplier Verification
Product Matching
Marketplace Discovery
Market Clearing Price
Landed Cost
Profit Engine
Demand Intelligence
Competition Intelligence
Risk Engine
EV Engine
Scenario Engine
Sensitivity Engine
Opportunity Scoring
Opportunity Lifecycle
Opportunity Decay
Collapse Detection
Test Order Decision
Scale Decision
Stop-Loss Logic
Realized Profit Tracking
Profit Attribution
Learning Loop
Model Evaluation
Model Calibration
```

If one of these is absent:

`MISSING_CAPABILITY`

If required for core arbitrage decision-making, it is a production blocker.

---

# 12. SUPPLIER SOURCING AUDIT

The system MUST identify actual suppliers rather than treating marketplace sellers as suppliers.

Supplier classifications MUST be supported where applicable:

* manufacturer
* factory
* distributor
* wholesaler
* importer
* authorized supplier
* other explicitly classified source

Audit:

* supplier identity
* supplier URL/source
* supplier type
* supplier availability
* supplier product
* supplier price
* MOQ
* unit quantity
* package size
* variant
* shipping origin
* shipping conditions
* timestamp
* source reliability
* evidence freshness

CRITICAL RULE:

```text
MARKETPLACE RETAIL PRICE
≠
SUPPLIER COST
```

A marketplace listing MUST NOT be used as a supplier cost unless independently proven to represent an actual supplier transaction.

Unknown supplier cost MUST remain UNKNOWN.

---

# 13. SUPPLIER AUTHENTICITY GATE

Supplier verification MUST include:

```text
Identity verification
Business classification
Product availability verification
Price evidence
MOQ evidence
Unit equivalence
Package equivalence
Variant equivalence
Timestamp freshness
Source reliability
```

A supplier lacking sufficient evidence MUST NOT generate a VERIFIED arbitrage opportunity.

Required test cases:

1. valid supplier
2. fake supplier
3. marketplace seller pretending to be supplier
4. stale supplier listing
5. missing MOQ
6. missing price
7. mismatched package size
8. mismatched variant
9. supplier unavailable
10. supplier price changed

---

# 14. PRODUCT / ENTITY RESOLUTION AUDIT

Matching MUST NOT rely solely on product title similarity.

Verify:

* brand
* model
* SKU
* GTIN/EAN/UPC where available
* variant
* dimensions
* quantity
* weight
* package count
* color
* size
* compatibility
* product attributes

Test:

```text
same product
different variant
different package
different quantity
bundle vs single unit
similar-looking product
counterfeit-like listing
accessory vs primary product
```

False-positive product matching MUST be treated as a financial risk.

---

# 15. MARKETPLACE INTELLIGENCE AUDIT

For every marketplace source verify:

* seller
* listing
* price
* quantity
* variant
* shipping
* voucher treatment
* platform fee
* seller concentration
* seller count
* price distribution
* listing freshness

Marketplace price data MUST retain provenance.

---

# 16. MARKET CLEARING PRICE ENGINE

The system MUST NOT assume:

```text
one listing price = market price
```

The engine MUST support, where sufficient data exists:

* multi-listing aggregation
* comparable-product filtering
* outlier rejection
* P10
* P25
* P50
* P75
* P90
* weighted median
* price dispersion
* seller concentration
* listing freshness
* confidence

Minimum audit cases:

```text
normal distribution
single outlier
multiple outliers
one dominant seller
extreme price dispersion
stale listing
insufficient sample
variant mismatch
bundle mismatch
```

If market data is insufficient:

```text
MARKET_PRICE_CONFIDENCE = LOW
```

The engine MUST NOT fabricate a clearing price.

---

# 17. FINANCIAL INTEGRITY AUDIT

All financial calculations MUST use exact decimal arithmetic.

Never use binary floating-point arithmetic for monetary calculations where precision matters.

Verify:

* purchase cost
* supplier cost
* shipping
* customs
* VAT/tax
* marketplace fees
* payment fees
* packaging
* handling
* inspection
* wastage
* returns
* operational overhead where applicable
* total landed cost
* gross profit
* net profit
* margin
* ROI
* capital requirement

---

# 18. FINANCIAL INVARIANTS

Mandatory invariants:

```text
UNKNOWN ≠ ZERO
```

```text
MISSING ≠ ZERO
```

```text
ESTIMATED ≠ VERIFIED
```

```text
MARKETPLACE_PRICE ≠ SUPPLIER_PRICE
```

```text
NEGATIVE_PROFIT ≠ OPPORTUNITY
```

```text
UNVERIFIED_SUPPLIER ≠ VERIFIED_OPPORTUNITY
```

```text
STALE_DATA ≠ FRESH_DATA
```

The system MUST fail closed when critical financial inputs are unknown.

---

# 19. LANDED COST AUDIT

No critical financial component may silently default to zero.

For every component record:

```text
value
source
confidence
timestamp
calculation method
configuration version
```

Hardcoded economic assumptions MUST be:

* explicitly documented
* configurable
* versioned
* auditable
* replaceable with verified values

Taxes, fees, logistics, packaging and customs MUST NOT be silently treated as permanent constants.

---

# 20. PROFIT ENGINE AUDIT

Verify:

```text
Revenue
- Supplier Cost
- Logistics
- Tax
- Platform Fees
- Payment Fees
- Packaging
- Returns/Wastage
- Other Applicable Costs
= Net Profit
```

Then verify:

```text
Net Profit > 0
```

for positive-profit opportunity classification.

Test:

* positive profit
* zero profit
* negative profit
* unknown supplier cost
* unknown shipping
* unknown fee
* extreme fee
* missing tax
* rounding boundary
* very small margin
* very large margin

---

# 21. DUAL-ENGINE VALIDATION

If two financial calculation engines exist, they MUST be sufficiently independent.

Simply rearranging algebra:

```text
A - (B + C)
```

and:

```text
(A - B) - C
```

does NOT constitute independent validation.

Independent validation SHOULD use:

* component aggregation
* alternative calculation path
* independently structured data
* invariant-based validation

Any validation engine sharing identical implementation logic MUST be marked:

`NOT_INDEPENDENT`

---

# 22. SCENARIO ENGINE AUDIT

The system MUST support scenario analysis where specified by `IDEA.md`.

At minimum verify:

```text
BEAR
BASE
BULL
```

Scenario assumptions MUST be explicit and versioned.

Test:

* positive base case
* negative bear case
* optimistic bull case
* supplier price increase
* selling price decrease
* fee increase
* logistics increase
* return-rate increase

---

# 23. SENSITIVITY ANALYSIS

Sensitivity analysis MUST identify variables that materially affect profitability.

Test:

```text
supplier price
market price
shipping
fees
tax
return rate
demand
competition
```

The robustness classification MUST be derived from actual sensitivity results.

A gate MUST NOT claim robustness merely because the base-case profit is positive.

---

# 24. DEMAND INTELLIGENCE AUDIT

Where required by `IDEA.md`, verify:

* demand score
* demand confidence
* sales velocity
* trend
* seasonality
* demand evidence
* freshness
* historical behavior
* prediction uncertainty

Unknown demand MUST NOT silently become high demand.

Test:

```text
high demand
medium demand
low demand
unknown demand
rapid demand decline
seasonal spike
stale demand data
```

---

# 25. DEMAND MODEL EVALUATION

Where models are used, evaluate:

* precision
* recall
* false-positive rate
* false-negative rate
* MAP@K
* NDCG@K
* calibration
* prediction error

Actual measured metrics MUST be reported.

If not measured:

`NOT_TESTED`

---

# 26. COMPETITION ENGINE AUDIT

Verify:

* seller count
* active seller count
* seller concentration
* HHI where applicable
* price dispersion
* dominant seller
* price-war detection
* competition velocity
* price compression
* seller influx

Test:

```text
single seller
few sellers
many sellers
dominant seller
rapid seller increase
rapid price compression
```

---

# 27. RISK ENGINE AUDIT

Risk MUST be decomposed.

At minimum evaluate where applicable:

* supplier risk
* product risk
* demand risk
* competition risk
* price risk
* logistics risk
* return risk
* platform risk
* regulatory risk
* data-quality risk
* execution risk

Each risk should have:

```text
risk_score
confidence
evidence
timestamp
mitigation
```

---

# 28. EXPECTED VALUE ENGINE

EV MUST be mathematically verifiable.

Required invariant:

```text
Σ probabilities = 1
```

Expected value:

```text
EV = Σ(Pi × payoff_i)
```

Verify:

* scenario definitions
* probability provenance
* payoff correctness
* probability normalization
* downside
* uncertainty
* sensitivity
* EV confidence

Positive EV MUST NOT automatically produce approval.

Approval still requires all mandatory business and financial gates.

---

# 29. OPPORTUNITY SCORE AUDIT

Scoring MUST be traceable to:

* profitability
* ROI
* demand
* competition
* supplier quality
* risk
* confidence
* robustness
* EV
* capital requirement
* freshness
* execution complexity

All weights MUST be:

* explicit
* versioned
* configurable where required
* documented
* testable

The implementation MUST match the specification.

---

# 30. OPPORTUNITY LIFECYCLE STATE MACHINE

Required lifecycle:

```text
DISCOVERED
→ ANALYZING
→ VALIDATING
→ VERIFIED
→ ALERTED
→ TESTING
→ VALIDATED
→ SCALING
→ MONITORING
```

Terminal or exceptional states may include:

```text
REJECTED
EXPIRED
COLLAPSED
PAUSED
INVALIDATED
```

Every transition MUST be:

* valid
* logged
* timestamped
* attributable
* idempotent where required
* concurrency-safe

Invalid transitions MUST be rejected.

---

# 31. OPPORTUNITY DECAY

Every opportunity MUST have freshness/decay logic where required.

Audit:

* TTL
* supplier price freshness
* marketplace price freshness
* demand freshness
* competition freshness
* stale data detection
* confidence decay
* opportunity half-life where applicable

Stale opportunity data MUST NOT remain indefinitely actionable.

---

# 32. OPPORTUNITY COLLAPSE DETECTION

The system MUST invalidate/recompute opportunities when material conditions change.

Test:

```text
supplier price +20%
market price -15%
competition +300%
supplier unavailable
MOQ changed
shipping increased
data expired
product match invalidated
risk increased
```

Expected behavior:

```text
RECOMPUTE
or
INVALIDATE
or
COLLAPSE
```

depending on specification.

---

# 33. TEST-ORDER DECISION AUDIT

Test-order recommendation requires evidence.

At minimum evaluate:

```text
positive EV
material uncertainty
affordable capital
acceptable supplier risk
demand evidence
acceptable downside
```

Test false approvals.

Example:

```text
EV positive
BUT supplier unverified
→ REJECT / DO NOT TEST
```

---

# 34. SCALE DECISION AUDIT

Scaling MUST NOT be based solely on theoretical margin.

Required evidence may include:

* actual sales
* actual margin
* actual return rate
* supplier reliability
* inventory behavior
* opportunity still active
* market stability
* robust economics

Test:

```text
theoretical profit high
actual performance poor
→ DO NOT SCALE
```

---

# 35. STOP-LOSS AUDIT

Verify automatic stop conditions.

Examples:

```text
margin collapse
supplier failure
return spike
market price collapse
competition explosion
negative realized profit
data invalidation
risk threshold exceeded
```

Stop-loss behavior MUST be deterministic and auditable.

---

# 36. REALIZED-PROFIT LEARNING LOOP

The system MUST support:

```text
PREDICTED
↓
RECOMMENDED
↓
TESTED
↓
ACTUAL
↓
ATTRIBUTION
↓
ERROR
↓
CALIBRATION
↓
MODEL UPDATE
```

Track:

* predicted profit
* actual profit
* prediction error
* margin error
* revenue error
* cost error
* return-rate error
* demand prediction error
* supplier prediction error

Primary business validation SHOULD prioritize:

```text
REALIZED PROFIT
per
RECOMMENDED OPPORTUNITY
```

---

# 37. PROFIT PREDICTION EVALUATION

Measure where sufficient historical data exists:

* MAE
* MAPE
* RMSE where appropriate
* bias
* overestimation
* underestimation
* calibration

Target thresholds MUST come from `IDEA.md`.

If the target cannot be measured:

`NOT_TESTED`

Do NOT claim compliance without measurement.

---

# 38. MODEL GOVERNANCE

Every model MUST have:

```text
model_id
model_version
training/configuration version
feature version
evaluation timestamp
evaluation dataset
metrics
approval status
```

Model changes MUST be:

* versioned
* tested
* evaluated
* auditable
* reversible

No silent model updates.

---

# 39. DATA LINEAGE AUDIT

Every critical datum MUST retain provenance.

Minimum:

```text
source
source_url / source_id
retrieved_at
parser_version
normalization_version
confidence
raw reference where appropriate
```

Financial outputs MUST be traceable back to source data.

---

# 40. DATA FRESHNESS

Every critical data field MUST define freshness requirements.

Audit:

* supplier price
* marketplace price
* demand
* competition
* shipping
* tax/fee configuration
* product availability

Expired data MUST be clearly identified.

---

# 41. DATA QUALITY

Verify:

* duplicate detection
* missing values
* malformed values
* impossible values
* unit normalization
* currency normalization
* variant normalization
* package normalization
* timestamp validity
* source consistency

Never silently convert invalid data into valid-looking data.

---

# 42. SECURITY AUDIT

Verify:

* secrets
* environment configuration
* authentication
* authorization
* RBAC
* input validation
* SSRF
* DNS rebinding
* redirects
* URL validation
* command injection
* SQL injection
* path traversal
* unsafe deserialization
* dependency vulnerabilities
* log leakage
* webhook validation
* Telegram authorization

---

# 43. SECRET MANAGEMENT

No real credentials may exist in:

* source code
* committed configuration
* logs
* reports
* tests
* fixtures
* documentation

If a real secret is discovered:

```text
P0
```

The report MUST state:

```text
SECRET REMEDIATION
+
ROTATION REQUIRED
```

Removing a secret from a file does NOT prove the credential has been revoked.

---

# 44. SSRF AUDIT

SSRF protection MUST include:

* URL scheme validation
* hostname validation
* DNS resolution
* IPv4 private ranges
* IPv6 private ranges
* loopback
* link-local
* multicast
* reserved ranges
* cloud metadata endpoints
* DNS rebinding defense
* redirect validation
* maximum redirects

Test:

```text
127.0.0.1
localhost
10.0.0.0/8
172.16.0.0/12
192.168.0.0/16
169.254.0.0/16
100.64.0.0/10
IPv6 loopback
IPv6 ULA
IPv6 link-local
metadata endpoints
DNS rebinding
redirect to private IP
```

---

# 45. DATABASE AUDIT

Verify:

* schema
* migrations
* indexes
* foreign keys
* uniqueness
* constraints
* transactions
* isolation
* locking
* connection pool
* retry behavior
* failure recovery
* backup assumptions

No destructive migration without explicit evidence and rollback strategy.

---

# 46. CONCURRENCY AUDIT

Test:

* duplicate opportunity creation
* duplicate alert
* concurrent state transition
* simultaneous supplier update
* simultaneous price update
* race conditions
* transaction conflicts
* idempotent retry

The same event MUST NOT produce uncontrolled duplicate side effects.

---

# 47. RELIABILITY AUDIT

Verify:

* timeout
* retry
* exponential backoff
* jitter
* rate limiting
* per-domain throttling
* circuit breaker
* queue behavior
* dead-letter handling
* graceful shutdown
* restart recovery
* partial failure
* dependency failure

Circuit breaker requirements from `IDEA.md` MUST be tested, including threshold behavior.

---

# 48. CIRCUIT BREAKER

Test:

```text
failure 1
failure 2
failure 3
failure 4
failure 5
```

Verify:

```text
CLOSED
→ OPEN
→ HALF_OPEN
→ CLOSED
```

according to the specified policy.

If the specification requires threshold = 5, test exactly that threshold.

---

# 49. QUEUE / DEAD-LETTER AUDIT

If asynchronous processing exists, verify:

* queue durability
* retry count
* poison message behavior
* DLQ
* replay
* deduplication
* idempotency
* ordering where required

If required but absent:

`MISSING_CAPABILITY`

---

# 50. OBSERVABILITY AUDIT

Verify:

* structured logging
* correlation ID
* request ID
* opportunity ID
* supplier ID
* product ID
* stage logging
* error classification
* metrics
* tracing where required
* health checks
* readiness checks
* liveness checks

Never log secrets.

---

# 51. REQUIRED BUSINESS METRICS

Where applicable verify availability of:

```text
crawl_success_rate
crawl_failure_rate
supplier_verification_rate
product_match_rate
opportunity_count
verified_opportunity_count
rejection_rate
false_positive_rate
profit_prediction_error
realized_profit
realized_margin
return_rate
supplier_failure_rate
opportunity_collapse_rate
alert_success_rate
```

---

# 52. PERFORMANCE AUDIT

Performance MUST be measured, not assumed.

Where defined by `IDEA.md`, verify target metrics including:

```text
pipeline E2E latency
database p99 latency
parser accuracy drift
profit prediction MAPE
```

Example target table:

| Metric                 |    Target |   Actual | Status    |
| ---------------------- | --------: | -------: | --------- |
| Pipeline E2E latency   | < 5000 ms | measured | PASS/FAIL |
| DB query p99           |   < 50 ms | measured | PASS/FAIL |
| Parser accuracy drift  |      < 1% | measured | PASS/FAIL |
| Profit prediction MAPE |     < 12% | measured | PASS/FAIL |

If not measured:

`NOT_TESTED`

---

# 53. PERFORMANCE TEST RULE

Do NOT use mock E2E execution time as production performance evidence.

A 1–6 ms mocked test does NOT prove a production pipeline can execute within target latency.

Production-like benchmark MUST include realistic:

* network
* parsing
* database
* aggregation
* intelligence
* calculation
* alerting

where applicable.

---

# 54. API CONTRACT AUDIT

Verify all required interfaces.

For each endpoint/command:

* authentication
* authorization
* validation
* schema
* response
* errors
* pagination
* idempotency
* rate limit
* observability

No endpoint should expose internal secrets or untrusted raw data unnecessarily.

---

# 55. TELEGRAM INTERFACE AUDIT

Where Telegram is used, verify:

* allowed users
* command parsing
* authorization
* rate limiting
* structured responses
* alert deduplication
* opportunity IDs
* error handling
* stale opportunity handling
* no secret leakage

Required command contracts should be verified against `IDEA.md`, including where applicable:

```text
/find
/top
/product
/supplier
/analyze
/validate
/test
/watch
/alerts
```

---

# 56. OPPORTUNITY INTELLIGENCE BRIEF

Opportunity output MUST be traceable and structured.

Where required, include:

```text
Product
Marketplace
Supplier
Supplier Cost
Market Price
Landed Cost
Profit
Margin
ROI
Demand
Competition
Risk
EV
Confidence
Robustness
Capital Required
Supplier Evidence
Marketplace Evidence
Timestamp
Decision
Reason
```

No field may be fabricated.

---

# 57. FAKE / STUB / PLACEHOLDER AUDIT

Search the entire repository for:

```text
TODO
FIXME
stub
mock
placeholder
hardcoded
return null
return []
return {}
not implemented
fake
dummy
example
sample
test-only
```

Then classify each occurrence.

A placeholder in a mandatory production path is a finding.

A stub MUST NOT be reported as a production implementation.

---

# 58. HARDCODED VALUE AUDIT

Search for hardcoded:

* taxes
* fees
* shipping
* supplier costs
* marketplace prices
* product IDs
* supplier IDs
* confidence scores
* probabilities
* model weights
* scoring weights
* business thresholds

Each MUST be classified:

```text
intentional constant
configuration
derived value
test fixture
temporary hardcode
violation
```

---

# 59. TEST AUDIT

Run:

```text
typecheck
unit tests
integration tests
E2E tests
security tests
financial invariant tests
adversarial tests
property-based tests where applicable
performance tests
```

Report exact commands.

Report exact results.

Never round or estimate test counts.

---

# 60. PROPERTY-BASED FINANCIAL TESTING

Where practical, test invariants across randomized values.

Examples:

```text
profit consistency
EV probability normalization
non-negative cost constraints
monotonicity
rounding stability
scenario consistency
```

---

# 61. ADVERSARIAL TESTING

Test malicious or pathological conditions:

```text
negative price
zero price
huge price
missing supplier
fake supplier
duplicate listing
variant mismatch
stale data
corrupt data
private URL
DNS rebinding
redirect attack
invalid currency
invalid quantity
overflow-like values
race conditions
duplicate events
```

---

# 62. REGRESSION AUDIT

Every remediated P0/P1 finding MUST receive a regression test.

Regression tests MUST remain after remediation.

A fix without a regression test SHOULD be considered incomplete unless a justified exception exists.

---

# 63. REMEDIATION REPORT REQUIREMENTS

For every finding record:

```text
Finding ID
Severity
Classification
Requirement
Observed behavior
Expected behavior
Root cause
Impact
Evidence
Remediation
Regression test
Verification command
Verification result
Residual risk
Status
```

---

# 64. NO FALSE CLOSURE

A finding may only be marked:

`CLOSED`

if:

1. root cause is fixed
2. implementation is correct
3. regression test exists
4. test passes
5. relevant build/typecheck passes
6. no contradictory evidence exists

Otherwise:

`OPEN`
or
`PARTIALLY_CLOSED`

---

# 65. RE-AUDIT REQUIREMENT

After remediation, a completely fresh audit MUST be performed.

The re-audit MUST:

* reload the repository
* inspect current source
* rerun verification
* verify regression tests
* verify security
* verify financial invariants
* verify mandatory capabilities
* compare previous findings
* detect new findings

Do NOT simply copy the previous report and change PASS/FAIL labels.

---

# 66. DIFFERENTIAL AUDIT

Report:

| Metric               | Before | After | Delta |
| -------------------- | -----: | ----: | ----: |
| P0                   |        |       |       |
| P1                   |        |       |       |
| P2                   |        |       |       |
| Tests                |        |       |       |
| Build                |        |       |       |
| Typecheck            |        |       |       |
| Security findings    |        |       |       |
| Missing capabilities |        |       |       |
| Financial violations |        |       |       |

---

# 67. PRODUCTION CERTIFICATION RULE

Production certification requires ALL mandatory conditions.

```text
P0 = 0
AND
Critical P1 = 0
AND
Mandatory IDEA clauses = PASS
AND
Core business capabilities = PASS
AND
Supplier verification = PASS
AND
Market clearing price = PASS
AND
Financial invariants = PASS
AND
Demand intelligence = PASS
AND
Competition intelligence = PASS
AND
EV engine = PASS
AND
Opportunity lifecycle = PASS
AND
Realized-profit learning = PASS
AND
Security = PASS
AND
Testing = PASS
AND
Performance targets = PASS
AND
Reliability = PASS
AND
Observability = PASS
AND
Deployment readiness = PASS
```

If ANY mandatory condition fails:

```text
PRODUCTION GATE = NOT READY
```

---

# 68. CRITICAL RULE

Technical health MUST NOT override business readiness.

This is invalid:

```text
Build PASS
Tests PASS
Typecheck PASS
Therefore Production Ready
```

Correct:

```text
Build
+
Tests
+
Financial Integrity
+
Security
+
Core Business Capability
+
Intelligence Correctness
+
Data Integrity
+
Reliability
+
Observability
+
Performance
+
Evidence
=
Production Readiness
```

---

# 69. SCORE MODEL

A score MAY be provided for prioritization.

Suggested domains:

| Domain                         | Weight |
| ------------------------------ | -----: |
| Specification Compliance       |    15% |
| Financial / Economic Integrity |    15% |
| Data Integrity & Lineage       |    10% |
| Security                       |    10% |
| Correctness & Code Quality     |    10% |
| Testing & Verification         |    10% |
| Reliability / Resilience       |     8% |
| Database / Distributed Systems |     7% |
| Performance                    |     5% |
| Observability                  |     4% |
| CI/CD / Deployment             |     3% |
| AI / Model Governance          |     3% |

However:

## SCORE MUST NEVER OVERRIDE A MANDATORY BLOCKER.

A system scoring 95/100 but missing supplier sourcing MUST remain:

```text
NOT READY
```

---

# 70. SCORE INTERPRETATION

Suggested:

```text
90–100  Excellent
80–89   Production Candidate
70–79   Needs Remediation
60–69   High Risk
<60     Unacceptable
```

But mandatory gates remain absolute.

---

# 71. PRODUCTION READINESS LEVELS

Use:

### LEVEL 0 — NON-FUNCTIONAL

Cannot compile or execute.

### LEVEL 1 — TECHNICAL SCAFFOLD

Builds and runs, but major business capabilities are missing.

### LEVEL 2 — FUNCTIONAL MVP

Core pipeline works but intelligence, financial verification, or resilience remains incomplete.

### LEVEL 3 — PRE-PRODUCTION

Core business capability exists and major controls are implemented, but production evidence is incomplete.

### LEVEL 4 — PRODUCTION CANDIDATE

Mandatory capabilities and controls pass, pending final operational deployment verification.

### LEVEL 5 — PRODUCTION CERTIFIED

All mandatory clauses, financial controls, security, intelligence, reliability, performance, observability and realized-profit validation pass.

---

# 72. FINAL CERTIFICATION FORMAT

The final report MUST include:

```text
AUDIT STATUS:
BASELINE / REMEDIATION / RE-AUDIT

P0:
P1:
P2:
P3:

MANDATORY CLAUSES:
PASS / PARTIAL / FAIL

CORE BUSINESS CAPABILITIES:
PASS / PARTIAL / FAIL

SUPPLIER SOURCING:
PASS / PARTIAL / FAIL

MARKET CLEARING PRICE:
PASS / PARTIAL / FAIL

FINANCIAL INTEGRITY:
PASS / PARTIAL / FAIL

DEMAND:
PASS / PARTIAL / FAIL

COMPETITION:
PASS / PARTIAL / FAIL

EV:
PASS / PARTIAL / FAIL

OPPORTUNITY LIFECYCLE:
PASS / PARTIAL / FAIL

REALIZED PROFIT LEARNING:
PASS / PARTIAL / FAIL

SECURITY:
PASS / PARTIAL / FAIL

TESTING:
PASS / PARTIAL / FAIL

PERFORMANCE:
PASS / PARTIAL / FAIL

RELIABILITY:
PASS / PARTIAL / FAIL

OBSERVABILITY:
PASS / PARTIAL / FAIL

DEPLOYMENT:
PASS / PARTIAL / FAIL

OVERALL SCORE:
XX/100

PRODUCTION GATE:
READY / NOT READY

PRODUCTION LEVEL:
LEVEL 0–5

BLOCKING CONDITIONS:
...

REMAINING RISKS:
...

NEXT REQUIRED ACTIONS:
...
```

---

# 73. REQUIRED FINAL REPORT SECTIONS

The generated audit report MUST contain:

```text
1. Executive Summary
2. Audit Baseline
3. Repository Revision
4. Methodology
5. Specification Traceability
6. Findings Summary
7. P0 Findings
8. P1 Findings
9. P2/P3 Findings
10. Supplier Sourcing Audit
11. Product Matching Audit
12. Marketplace Intelligence Audit
13. Market Clearing Price Audit
14. Financial Integrity Audit
15. Demand Intelligence Audit
16. Competition Audit
17. Risk Audit
18. EV Audit
19. Scenario Audit
20. Sensitivity Audit
21. Opportunity Lifecycle Audit
22. Opportunity Decay Audit
23. Collapse Detection Audit
24. Test Order Audit
25. Scale Audit
26. Stop-Loss Audit
27. Realized Profit / Learning Audit
28. Model Evaluation
29. Data Lineage
30. Security Audit
31. Database Audit
32. Concurrency Audit
33. Reliability Audit
34. Observability Audit
35. Performance Audit
36. API / Telegram Audit
37. Fake / Stub / Hardcode Audit
38. Testing Results
39. Regression Results
40. Remediation Results
41. Differential Summary
42. Remaining Risks
43. Production Gate
44. Certification
45. Recommended Next Actions
```

---

# 74. ABSOLUTE AUDITOR RULES

The auditor MUST:

1. Never fabricate evidence.
2. Never downgrade a mandatory requirement.
3. Never treat missing capability as PASS.
4. Never treat NOT_TESTED as PASS.
5. Never treat UNKNOWN as ZERO.
6. Never treat marketplace price as supplier cost without evidence.
7. Never treat one listing as market clearing price.
8. Never approve based solely on theoretical profit.
9. Never approve an unverified supplier.
10. Never allow negative profit to become an opportunity.
11. Never allow stale data to appear fresh.
12. Never allow hardcoded values to masquerade as verified economics.
13. Never claim model accuracy without measured evaluation.
14. Never claim performance without benchmarks.
15. Never claim security without security verification.
16. Never claim production readiness because build/tests pass.
17. Never close a finding without evidence.
18. Never silently modify the specification to match implementation.
19. Never hide deferred findings.
20. Never overwrite previous findings without preserving traceability.

---

# 75. FINAL AUDIT PHILOSOPHY

The purpose of this audit is NOT to make the repository look healthy.

The purpose is to determine whether the system is actually trustworthy.

The audit must aggressively distinguish:

```text
CODE EXISTS
vs
FEATURE WORKS

FEATURE WORKS
vs
FEATURE IS CORRECT

FEATURE IS CORRECT
vs
FEATURE IS VERIFIED

FEATURE IS VERIFIED
vs
FEATURE IS PRODUCTION-SAFE

THEORETICAL PROFIT
vs
REALIZED PROFIT
```

The final objective is:

```text
SOURCE DISCOVERY
        ↓
SUPPLIER VERIFICATION
        ↓
PRODUCT MATCHING
        ↓
MARKET INTELLIGENCE
        ↓
MARKET CLEARING PRICE
        ↓
LANDED COST
        ↓
PROFIT
        ↓
DEMAND
        ↓
COMPETITION
        ↓
RISK
        ↓
EV
        ↓
ROBUSTNESS
        ↓
OPPORTUNITY SCORE
        ↓
VALIDATION
        ↓
TEST ORDER
        ↓
REALIZED RESULT
        ↓
PROFIT ATTRIBUTION
        ↓
LEARNING
        ↓
CALIBRATION
        ↓
REVALIDATION
        ↓
SCALING
```

A production-grade arbitrage intelligence engine MUST be capable of proving the integrity of this entire chain.

---

# 76. FINAL PRODUCTION DECISION

The auditor MUST output exactly one final classification:

```text
PRODUCTION_CERTIFIED
```

or:

```text
PRODUCTION_CANDIDATE
```

or:

```text
PRE_PRODUCTION
```

or:

```text
DEVELOPMENT
```

or:

```text
NOT_READY
```

If any mandatory business capability is missing, the final result MUST NOT be:

```text
PRODUCTION_CERTIFIED
```

If the system cannot perform its core arbitrage objective because supplier sourcing or equivalent mandatory intelligence is missing, the correct classification is:

```text
NOT_READY
```

even if:

```text
BUILD = PASS
TESTS = PASS
TYPECHECK = PASS
```

---

# END OF AUDIT.md

````

## Kesimpulan final

Dengan versi ini, hubungan tiga file lo menjadi jauh lebih ketat:

```text
IDEA.md
│
│  WHAT MUST EXIST
▼
AUDIT.md
│
│  HOW TO PROVE IT
▼
MASTER EXECUTION PROMPT
│
│  HOW TO BUILD IT
▼
IMPLEMENTATION
│
▼
AUDIT
│
▼
REMEDIATION
│
▼
FRESH RE-AUDIT
│
▼
PRODUCTION GATE
````
