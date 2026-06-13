/**
 * MCP Server implementation for the extension
 */

import type { 
  Tool,
  TextContent,
  ResourceContents,
} from '@modelcontextprotocol/sdk/types.js';
import NativeServerClient from './nativeServerClient.js';

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface ToolResult {
  content: Array<{
    type: 'text' | 'image';
    text?: string;
    data?: string;
    mimeType?: string;
  }>;
}

class MCPServerManager {
  private nativeServerClient: NativeServerClient | null = null;
  private tools: Map<string, ToolDefinition> = new Map();

  async initialize(nativeServerClient: NativeServerClient) {
    this.nativeServerClient = nativeServerClient;

    try {
      // Fetch available tools from native server
      const response = await nativeServerClient.request<{ tools: ToolDefinition[] }>('/mcp/tools');
      
      if (response && Array.isArray(response.tools)) {
        response.tools.forEach(tool => {
          this.tools.set(tool.name, tool);
        });
      }
    } catch (error) {
      console.warn('Failed to fetch tools from native server:', error);
    }
  }

  getTools(): ToolDefinition[] {
    return Array.from(this.tools.values());
  }
}

export default MCPServerManager;
