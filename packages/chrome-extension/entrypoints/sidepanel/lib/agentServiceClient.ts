export interface AgentServiceConfig {
  url: string;
}

export const DEFAULT_AGENT_SERVICE_URL = 'http://localhost:3000';

export async function getAgentServiceConfig(): Promise<AgentServiceConfig> {
  return new Promise((resolve) => {
    chrome.storage.sync.get(['agentServiceUrl'], (result) => {
      resolve({ url: result.agentServiceUrl || DEFAULT_AGENT_SERVICE_URL });
    });
  });
}

export async function saveAgentServiceConfig(config: AgentServiceConfig): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.sync.set({ agentServiceUrl: config.url }, resolve);
  });
}

export async function checkAgentServiceHealth(url: string): Promise<boolean> {
  try {
    const res = await fetch(`${url}/health`, { signal: AbortSignal.timeout(3000) });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Push native-server config to agent-service so it can connect to MCP.
 * Called after saving settings or on startup when both services are ready.
 */
export interface HealthStatus {
  status: string;
  provider?: { configured: boolean; provider?: string | null; model?: string | null; toolsSupported?: boolean | null };
  mcp?: string;
}

export async function checkAgentServiceHealthFull(url: string): Promise<HealthStatus | null> {
  try {
    const res = await fetch(`${url}/health`, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

export async function pushProviderConfig(
  agentServiceUrl: string,
  provider: string,
  apiKey: string,
  model?: string,
  baseUrl?: string,
  toolsSupported?: boolean,
): Promise<boolean> {
  try {
    const res = await fetch(`${agentServiceUrl}/provider-config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider, apiKey, model, baseUrl, toolsSupported }),
      signal: AbortSignal.timeout(5000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function pushNativeConfigToAgentService(
  agentServiceUrl: string,
  nativeServerUrl: string,
  authToken: string,
): Promise<boolean> {
  try {
    const res = await fetch(`${agentServiceUrl}/native-config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nativeServerUrl, authToken }),
      signal: AbortSignal.timeout(3000),
    });
    return res.ok;
  } catch {
    return false;
  }
}
