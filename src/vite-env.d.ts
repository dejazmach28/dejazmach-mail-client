/// <reference types="vite/client" />
import type { DesktopApi } from "../shared/contracts.js";

declare global {
  interface Window {
    desktopApi?: DesktopApi;
  }
}

export {};
