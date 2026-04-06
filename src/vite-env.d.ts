/// <reference types="vite/client" />

declare global {
  interface Window {
    desktopApi: {
      getShellState: () => Promise<{
        appName: string;
        version: string;
        platform: string;
        secureDesktopMode: boolean;
        securityMetrics: Array<{
          label: string;
          value: string;
          status: "active" | "monitoring" | "idle";
          detail: string;
        }>;
        transparencyLedger: string[];
      }>;
    };
  }
}

export {};
