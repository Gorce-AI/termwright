import {
  sessionCapabilitiesFromProducers,
  type CapabilityNodeId,
  type EffectiveSessionContract,
  type EvidenceProvenance,
  type SessionCapabilityId,
} from "@termwright/protocol";
import type { SemanticAttachment } from "../semantic.js";

/** Immutable inputs from which the session's negotiated contract is frozen. */
export interface SessionContractInput {
  readonly sessionId: string;
  readonly attachment: SemanticAttachment | null;
  readonly terminalProfile: string;
  readonly platform: NodeJS.Platform;
  readonly modesObservable?: boolean;
}

/** Builds the semantic-plane contract without a PTY, socket, VT or host. */
export function buildSessionContract(input: SessionContractInput): EffectiveSessionContract {
  const attachment = input.attachment;
  const terminalEvidence: EvidenceProvenance = Object.freeze({
    source: "terminal", method: "native", strength: "authoritative", providerId: "termwright-vt",
  });
  const frameworkId = attachment?.probe?.framework ?? attachment?.adapter.name ?? "generic";
  const frameworkEvidence: EvidenceProvenance = Object.freeze({
    source: "framework",
    method: attachment?.probe === null || attachment?.probe === undefined ? "declared" : "instrumented",
    strength: "authoritative",
    providerId: frameworkId,
  });
  const applicationEvidence = (providerId: string, method: "native" | "declared"): EvidenceProvenance =>
    Object.freeze({ source: "application", method, strength: "authoritative", providerId });
  const supported = (evidence: EvidenceProvenance) => Object.freeze({ status: "supported" as const, evidence });
  const unsupported = (reason: "not-negotiated" | "framework-unobservable" | "terminal-unobservable" | "provider-required") =>
    Object.freeze({ status: "unsupported" as const, reason });

  const advertised = new Set(attachment?.capabilities ?? []);
  const probe = new Set(attachment?.probe?.capabilities ?? []);
  const producerNodes = new Set<CapabilityNodeId>();
  for (const capability of advertised) producerNodes.add(`adapter.${capability}`);
  for (const capability of probe) producerNodes.add(`probe.${capability}`);
  for (const provider of attachment?.providers ?? []) {
    for (const capability of provider.capabilities) producerNodes.add(`provider.${capability}`);
  }
  producerNodes.add("terminal.writable-pty");
  if (input.modesObservable ?? input.platform !== "win32") {
    producerNodes.add("terminal.input-modes-observable");
  }
  const produced = sessionCapabilitiesFromProducers(producerNodes);
  const evidenceFor = (capability: SessionCapabilityId): EvidenceProvenance => {
    const sources = produced.get(capability) ?? [];
    const providerSource = sources.find((source) => source.startsWith("provider."));
    if (providerSource !== undefined) {
      const providerCapability = providerSource.slice("provider.".length);
      const provider = attachment?.providers.find((candidate) =>
        candidate.capabilities.includes(providerCapability as never));
      if (provider !== undefined) return applicationEvidence(provider.id, provider.method);
    }
    return sources.some((source) => source.startsWith("terminal.")) ? terminalEvidence : frameworkEvidence;
  };
  const unsupportedReason = (capability: SessionCapabilityId) =>
    capability === "pointer-input" || capability === "focus-input"
      ? ("terminal-unobservable" as const)
      : capability === "pointer-geometry" || capability === "pointer-hit-testing" ||
          capability === "focus" || capability === "action-strategies"
        ? ("provider-required" as const)
        : capability === "semantic-tree" || capability === "paired-revisions"
          ? ("not-negotiated" as const)
          : ("framework-unobservable" as const);
  const capabilities = Object.fromEntries(
    (Object.keys({
      "semantic-tree": 0, "stable-identity": 0, "intended-geometry": 0,
      "clipped-geometry": 0, "painted-region": 0, "pointer-geometry": 0,
      "pointer-hit-testing": 0, focus: 0, scroll: 0, "render-order": 0,
      "action-strategies": 0, "keyboard-input": 0, "pointer-input": 0,
      "focus-input": 0, "paired-revisions": 0,
    }) as SessionCapabilityId[]).map((capability) => [
      capability,
      produced.has(capability) ? supported(evidenceFor(capability)) : unsupported(unsupportedReason(capability)),
    ]),
  ) as EffectiveSessionContract["capabilities"];
  const providers = attachment === null
    ? [Object.freeze({ id: "termwright-vt", kind: "terminal" as const, version: "1" })]
    : [
        Object.freeze({
          id: frameworkId,
          kind: "framework" as const,
          version: attachment.probe?.frameworkVersion ?? attachment.adapter.version,
        }),
        ...attachment.providers.map((provider) => Object.freeze({
          id: provider.id,
          kind: "application" as const,
          version: provider.version,
          method: provider.method,
          capabilities: Object.freeze([...provider.capabilities]),
        })),
        Object.freeze({ id: "termwright-vt", kind: "terminal" as const, version: "1" }),
      ];
  return Object.freeze({
    contractId: `${input.sessionId}:0`,
    sessionId: input.sessionId,
    epoch: 0,
    protocol: "termwright/2" as const,
    framework: attachment === null ? null : Object.freeze({
      name: frameworkId,
      version: attachment.probe?.frameworkVersion ?? attachment.adapter.version,
      adapterVersion: attachment.adapter.version,
      certificationId: `${frameworkId}@${attachment.probe?.frameworkVersion ?? attachment.adapter.version}/${attachment.adapter.version}`,
    }),
    providers: Object.freeze(providers),
    capabilities: Object.freeze(capabilities),
    terminal: Object.freeze({
      profile: input.terminalProfile,
      platform: input.platform,
      mouseModesObservable: input.modesObservable ?? input.platform !== "win32",
    }),
  });
}
