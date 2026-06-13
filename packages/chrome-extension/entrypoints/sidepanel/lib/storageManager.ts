/**
 * Storage manager for extension configuration
 */

export interface ExtensionConfig {
  nativeServerUrl: string;
  authToken: string;
}

const STORAGE_KEY = 'clawathon_mcp_config';

class StorageManager {
  async getConfig(): Promise<ExtensionConfig | null> {
    try {
      const data = await chrome.storage.sync.get(STORAGE_KEY);
      return data[STORAGE_KEY] || null;
    } catch {
      return null;
    }
  }

  async saveConfig(config: ExtensionConfig): Promise<void> {
    await chrome.storage.sync.set({ [STORAGE_KEY]: config });
  }

  async clearConfig(): Promise<void> {
    await chrome.storage.sync.remove(STORAGE_KEY);
  }

  async isConfigured(): Promise<boolean> {
    const config = await this.getConfig();
    return !!config?.nativeServerUrl && !!config?.authToken;
  }
}

export default new StorageManager();
