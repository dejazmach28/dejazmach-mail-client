export type RuntimeEnvironment = "development" | "production";

type ShellPolicyInput = {
  appUrl: string;
  environment: RuntimeEnvironment;
};

const SAFE_EXTERNAL_PROTOCOLS = new Set(["https:", "mailto:"]);
const SAFE_EMBEDDED_PROTOCOLS = new Set(["file:", "data:", "blob:"]);

const parseUrl = (value: string) => {
  try {
    return new URL(value);
  } catch {
    return null;
  }
};

const isSameOrigin = (value: string, origin: string) => {
  const parsedValue = parseUrl(value);
  const parsedOrigin = parseUrl(origin);

  if (!parsedValue || !parsedOrigin) {
    return false;
  }

  return parsedValue.origin === parsedOrigin.origin;
};

export const isSafeExternalUrl = (value: string) => {
  const parsed = parseUrl(value);
  return parsed ? SAFE_EXTERNAL_PROTOCOLS.has(parsed.protocol) : false;
};

export const isAllowedNavigation = (value: string, input: ShellPolicyInput) => {
  const parsed = parseUrl(value);

  if (!parsed) {
    return false;
  }

  if (parsed.protocol === "file:") {
    return true;
  }

  return input.environment === "development" && isSameOrigin(value, input.appUrl);
};

export const isAllowedRendererRequest = (value: string, input: ShellPolicyInput) => {
  const parsed = parseUrl(value);

  if (!parsed) {
    return false;
  }

  if (SAFE_EMBEDDED_PROTOCOLS.has(parsed.protocol)) {
    return true;
  }

  return input.environment === "development" && isSameOrigin(value, input.appUrl);
};

export const getEnvironment = (appIsPackaged: boolean, devServerUrl?: string): RuntimeEnvironment => {
  if (!appIsPackaged && devServerUrl) {
    return "development";
  }

  return "production";
};
