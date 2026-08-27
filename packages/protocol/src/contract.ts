export {
  ADAPTER_CAPABILITIES,
  EVIDENCE_PROVIDER_CAPABILITIES,
  SESSION_CAPABILITIES,
} from './capability-graph.js';
export type {
  AdapterCapability,
  EvidenceProviderCapability,
  SessionCapabilityId,
} from './capability-graph.js';
export {
  PROBE_DEGRADED_CAPABILITIES,
  PROBE_INJECTION_TIERS,
  PROBE_SEMANTIC_CLASSES,
} from './probe/ir.js';
import type { EvidenceProviderCapability, SessionCapabilityId } from './capability-graph.js';
import type { ProbeInstrumentation } from './probe/ir.js';

/**
 * Stable application provider identity announced in the adapter hello.
 *
 * Providers are collected before hello is sent. The declaration is therefore
 * part of the same immutable negotiation as framework and terminal evidence;
 * there is no late-registration message and no mutable side channel.
 */
export interface EvidenceProviderRegistration {
  readonly id: string;
  readonly version: string;
  readonly capabilities: readonly EvidenceProviderCapability[];
  /** How the application obtains its authoritative production-router facts. */
  readonly method: 'native' | 'declared';
}

/** Where a fact originated, how it was obtained, and what consumers may infer. */
export interface EvidenceProvenance {
  readonly source: 'framework' | 'application' | 'terminal' | 'recognizer' | 'driver';
  readonly method:
    'native' | 'instrumented' | 'declared' | 'correlated' | 'measured' | 'derived' | 'heuristic';
  readonly strength: 'authoritative' | 'diagnostic';
  /** Stable identity of the producer, never a display label. */
  readonly providerId: string;
}

export function evidence(
  source: EvidenceProvenance['source'],
  method: EvidenceProvenance['method'],
  strength: EvidenceProvenance['strength'],
  providerId: string,
): EvidenceProvenance {
  if (providerId.trim().length === 0) throw new TypeError('evidence providerId must not be empty');
  return Object.freeze({ source, method, strength, providerId });
}

export type SessionCapabilityAvailability =
  | { readonly status: 'supported'; readonly evidence: EvidenceProvenance }
  | {
      readonly status: 'unsupported';
      readonly reason:
        'not-negotiated' | 'framework-unobservable' | 'terminal-unobservable' | 'provider-required';
    };

export type ContractProvider =
  | {
      readonly id: string;
      readonly kind: 'framework' | 'terminal';
      readonly version: string;
    }
  | {
      readonly id: string;
      readonly kind: 'application';
      readonly version: string;
      readonly method: 'native' | 'declared';
      readonly capabilities: readonly EvidenceProviderCapability[];
    };

/**
 * Immutable public contract negotiated once for one session epoch.
 *
 * Runtime state (disabled nodes, clipping, terminal modes currently off) is
 * intentionally absent. Those are actionability observations, not capability.
 */
export interface EffectiveSessionContract {
  readonly contractId: string;
  readonly sessionId: string;
  readonly epoch: number;
  readonly protocol: 'termwright/2';
  readonly framework: {
    readonly name: string;
    readonly version: string;
    readonly adapterVersion: string;
    readonly certificationId: string;
    /** Runtime attachment facts declared by a framework probe, when available. */
    readonly instrumentation?: ProbeInstrumentation;
  } | null;
  readonly providers: readonly ContractProvider[];
  readonly capabilities: Readonly<Record<SessionCapabilityId, SessionCapabilityAvailability>>;
  readonly terminal: {
    readonly profile: string;
    readonly platform: string;
    readonly mouseModesObservable: boolean;
  };
}
