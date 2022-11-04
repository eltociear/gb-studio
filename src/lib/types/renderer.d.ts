export interface SplashAPI {
  platform: string;
  l10n: (key: string, params?: Record<string, string | number>) => string;
  openExternal: (path: string) => Promise<void>;
}

declare global {
  interface Window {
    SplashAPI: SplashAPI;
  }
}