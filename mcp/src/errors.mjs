export class AgentMcpError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "AgentMcpError";
    this.code = code;
    this.details = details;
  }
}

export class UnsupportedCapabilityError extends AgentMcpError {
  constructor(provider, capability, reason) {
    super("unsupported_capability", `${provider} does not support ${capability}`, {
      provider,
      capability,
      reason,
    });
  }
}

export function asAgentMcpError(error, fallbackCode = "provider_error") {
  if (error instanceof AgentMcpError) return error;
  const message = error instanceof Error ? error.message : String(error);
  return new AgentMcpError(fallbackCode, message, {
    providerError: error instanceof Error ? error.name : typeof error,
  });
}

export function errorPayload(error) {
  const normalized = asAgentMcpError(error);
  return {
    error: {
      code: normalized.code,
      message: normalized.message,
      details: normalized.details,
    },
  };
}
