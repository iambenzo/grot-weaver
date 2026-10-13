export interface PluginSettings {
  defaultWindow?: string;
}

export function readSettings(jsonData: unknown): PluginSettings {
  if (!jsonData || typeof jsonData !== 'object') {
    return {};
  }
  const { defaultWindow } = jsonData as Record<string, unknown>;
  return typeof defaultWindow === 'string' ? { defaultWindow } : {};
}
