/**
 * Authenticated HTTP client for connecting to native-server gateway
 */

export interface NativeServerConfig {
  url: string;
  authToken: string;
}

class NativeServerClient {
  private config: NativeServerConfig;

  constructor(config: NativeServerConfig) {
    this.config = config;
  }

  /**
   * Make authenticated request to native server
   */
  async request<T = unknown>(
    path: string,
    options: RequestInit = {}
  ): Promise<T> {
    const url = `${this.config.url}${path}`;
    
    const headers = new Headers(options.headers || {});
    headers.set('Authorization', `Bearer ${this.config.authToken}`);
    headers.set('Content-Type', 'application/json');

    const response = await fetch(url, {
      ...options,
      headers,
    });

    if (!response.ok) {
      throw new Error(
        `Native server error: ${response.status} ${response.statusText}`
      );
    }

    if (response.headers.get('content-type')?.includes('application/json')) {
      return (await response.json()) as T;
    }

    return response.text() as unknown as T;
  }

  /**
   * Check if native server is ready
   */
  async isReady(): Promise<boolean> {
    try {
      const response = await fetch(`${this.config.url}/ready`);
      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * Check health status
   */
  async health() {
    return this.request('/health');
  }

  /**
   * Send MCP message to native server
   */
  async sendMCPMessage<T = unknown>(message: unknown): Promise<T> {
    return this.request('/mcp', {
      method: 'POST',
      body: JSON.stringify(message),
    });
  }
}

export default NativeServerClient;
