/** Types shared by the server, the SDK, the console. */

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

export const FLAG_KINDS = ['boolean', 'string', 'number', 'json'] as const;
export type FlagKind = (typeof FLAG_KINDS)[number];

export const ROLES = ['owner', 'editor', 'viewer'] as const;
export type Role = (typeof ROLES)[number];

export const API_KEY_KINDS = ['server', 'client'] as const;
export type ApiKeyKind = (typeof API_KEY_KINDS)[number];

export const ENVIRONMENT_KEYS = ['development', 'staging', 'production'] as const;

export interface Variation {
  value: JsonValue;
  name?: string;
  description?: string;
}

export const CLAUSE_OPS = ['in', 'contains', 'startsWith', 'endsWith', 'lt', 'lte', 'gt', 'gte', 'before', 'after'] as const;
export type ClauseOp = (typeof CLAUSE_OPS)[number];

export type ClauseValue = string | number | boolean;

export interface Clause {
  /** Context attribute, for example "country" or "key". */
  attribute: string;
  op: ClauseOp;
  values: ClauseValue[];
  /** Inverts the result. A missing attribute still never matches. */
  negate?: boolean;
}

export interface WeightedVariation {
  variation: number;
  /** Share of the 10,000 buckets. All weights in a rollout add up to 10,000. */
  weight: number;
}

export interface Rollout {
  variations: WeightedVariation[];
  /** Context attribute to bucket by. Defaults to "key". */
  bucketBy?: string;
}

export type Serve = { variation: number } | { rollout: Rollout };

export interface Rule {
  id: string;
  description?: string;
  clauses: Clause[];
  serve: Serve;
}

export interface Target {
  variation: number;
  /** Context keys that get this variation. */
  values: string[];
}

/** The per-environment part of a flag. */
export interface FlagEnvironmentState {
  on: boolean;
  /** A kill switch serves the off variation even when the flag is on, and keeps the rules as they are. */
  killed: boolean;
  offVariation: number;
  fallthrough: Serve;
  targets: Target[];
  rules: Rule[];
}

/** Everything an SDK needs to evaluate 1 flag in 1 environment. */
export interface FlagConfig extends FlagEnvironmentState {
  key: string;
  kind: FlagKind;
  variations: Variation[];
  /** Increases on every change to the flag or its state in this environment. */
  version: number;
}

export type AttributeValue = string | number | boolean | null | undefined | Array<string | number>;

/** Who a flag is evaluated for. `key` is an opaque id, never a name or e-mail address. */
export interface EvalContext {
  key: string;
  [attribute: string]: AttributeValue;
}

export type EvalReasonKind = 'OFF' | 'KILLED' | 'TARGET_MATCH' | 'RULE_MATCH' | 'FALLTHROUGH' | 'ERROR';

export interface EvalReason {
  kind: EvalReasonKind;
  ruleId?: string;
  ruleIndex?: number;
  /** Set when a rollout chose the variation. */
  bucket?: number;
  errorKind?: 'FLAG_NOT_FOUND' | 'MALFORMED_FLAG';
}

export interface EvalResult<T = JsonValue> {
  value: T;
  variation: number | null;
  reason: EvalReason;
}

/** Evaluated flag as a client key sees it: no rules, only the result. */
export interface EvaluatedFlag {
  key: string;
  value: JsonValue;
  variation: number | null;
  version: number;
  reason: EvalReason;
}
