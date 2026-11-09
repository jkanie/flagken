# Roadmap

12 items, 49.5 hours in total. Each item lists its hours, what it changes, why. Item 1 stands alone: it needs no other item and no other item waits for it.

| #   | Item                                           | Hours |
| --- | ---------------------------------------------- | ----- |
| 1   | Audit outbox in the same transaction           | 2.5   |
| 2   | Segments                                       | 4     |
| 3   | Experiments with statistics                    | 8     |
| 4   | OIDC single sign-on                            | 6     |
| 5   | Publish the SDK to npm with versioned releases | 4     |
| 6   | Webhook secret rotation                        | 2     |
| 7   | Approvals for production changes               | 6     |
| 8   | Paging and tag filters on the flags list       | 2     |
| 9   | Evaluation insights and stale flags            | 4     |
| 10  | Per-project roles                              | 5     |
| 11  | Kubernetes manifests                           | 3     |
| 12  | Relay mode for edge and private networks       | 3     |

## 1. Audit outbox in the same transaction (2.5 hours)

Today the flag service commits the change, then the audit interceptor writes the entry in a second statement. A database failure between the 2 leaves a change without an entry.

- Write the audit entry and an outbox row inside the transaction that changes the flag. The interceptor keeps building the entry, the service hands it the transaction.
- A small relay reads the outbox in order, publishes to Redis, queues webhooks, then marks the row sent. `FOR UPDATE SKIP LOCKED` lets several instances share the work.
- Test: make the publish fail on purpose and check that the entry exists and the event goes out on the next relay run.

Why first: it closes the only gap where the audit log can miss a change, and it touches 3 files.

## 2. Segments (4 hours)

Reusable lists of context keys and rules ("beta testers", "staff"), referenced from flag rules with a new `inSegment` operator.

- Table, CRUD endpoints, console page, audit entries.
- The rules engine resolves segments from a map passed in, so server and SDK keep 1 code path. Server keys receive segments in `put` and `patch` events.

## 3. Experiments with statistics (8 hours)

Turn a rollout into an experiment with a primary metric.

- The SDK reports exposures (flag, variation, context key hash) and the app reports conversion events through a new `track()` call. Both go to a batched endpoint, stored in a PostgreSQL table partitioned by day.
- Results per variation: users exposed, conversions, conversion rate with a 95% Wilson interval, the difference from control with a 2-proportion z-test, a Bayesian probability to beat control from Beta-Binomial posteriors.
- A sample ratio mismatch check (chi-square on exposure counts against the configured weights) warns when the split is broken, before anyone reads the results.
- Tests pin the maths against hand-computed values.

## 4. OIDC single sign-on (6 hours)

- Authorization code flow with PKCE against any OpenID Connect provider (issuer URL, client id, client secret in settings).
- Map a claim (groups or roles) to owner, editor, viewer. Accounts are made on first sign-in only when a mapping matches.
- Local passwords stay for the break-glass owner and can be turned off.
- Integration test against a local OIDC provider in a container.

## 5. Publish the SDK to npm with versioned releases (4 hours)

- Rename to a public scope, add `exports` with types for Node.js and browsers, a size budget, a README for the package.
- Changesets for version bumps and changelogs. A release workflow publishes on a version tag with npm provenance.
- A compatibility matrix in CI: Node.js 20, 22, 24, 26, plus a browser bundle test.

## 6. Webhook secret rotation (2 hours)

- An endpoint makes a second secret. Both sign each delivery (2 `v1=` values, which the verifier already accepts) until the old one is retired.
- Encrypt stored secrets with a key from the environment.

## 7. Approvals for production changes (6 hours)

- A per-environment setting requires a second editor to approve a change before it applies.
- Change requests hold the proposed state, the ETag it was based on, a comment. Applying uses the same version check, so a stale request fails with 412.

## 8. Paging and tag filters on the flags list (2 hours)

- Cursor paging (the list stops at 500 flags today), sort by key or last change, filter by tag and by state.

## 9. Evaluation insights and stale flags (4 hours)

- SDKs send counts per flag and variation every minute (no context data).
- The console shows when each flag was last evaluated in each environment and lists flags that serve 1 variation to everyone, as candidates for removal from code.

## 10. Per-project roles (5 hours)

- Roles per project instead of 1 role for the whole installation, so teams share 1 server without editing each other's flags.

## 11. Kubernetes manifests (3 hours)

- A Helm chart with separate deployments for API and workers (`WORKERS_ENABLED`), readiness and liveness probes on the health endpoints, a pod disruption budget, a ServiceMonitor for Prometheus.

## 12. Relay mode for edge and private networks (3 hours)

- The server runs as a read-only relay that holds 1 environment from an upstream flagken and serves SDKs in a private network or at the edge, so apps there need no route to the main server.
