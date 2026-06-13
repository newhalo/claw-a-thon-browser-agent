/**
 * Client for agent-service (port 3000).
 * Config stored in chrome.storage.sync alongside native-server config.
 */

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
