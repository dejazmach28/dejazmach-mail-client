import fs from "node:fs";
import path from "node:path";
import type { BrowserWindow } from "electron";

type WindowBounds = {
  width: number;
  height: number;
  x?: number;
  y?: number;
};

const DEFAULT_BOUNDS: WindowBounds = {
  width: 1520,
  height: 980
};

const MIN_WIDTH = 1180;
const MIN_HEIGHT = 760;

const clamp = (value: number, minimum: number) => Math.max(value, minimum);

export const normalizeWindowBounds = (bounds?: Partial<WindowBounds>): WindowBounds => ({
  width: clamp(bounds?.width ?? DEFAULT_BOUNDS.width, MIN_WIDTH),
  height: clamp(bounds?.height ?? DEFAULT_BOUNDS.height, MIN_HEIGHT),
  ...(typeof bounds?.x === "number" ? { x: bounds.x } : {}),
  ...(typeof bounds?.y === "number" ? { y: bounds.y } : {})
});

const readJsonBounds = (filePath: string) => {
  try {
    const fileContents = fs.readFileSync(filePath, "utf8");
    return normalizeWindowBounds(JSON.parse(fileContents) as Partial<WindowBounds>);
  } catch {
    return DEFAULT_BOUNDS;
  }
};

export const createWindowStateStore = (userDataPath: string) => {
  const filePath = path.join(userDataPath, "window-state.json");

  return {
    load: () => readJsonBounds(filePath),
    save: (window: BrowserWindow) => {
      const bounds = normalizeWindowBounds(window.getBounds());
      fs.mkdirSync(userDataPath, { recursive: true });
      fs.writeFileSync(filePath, JSON.stringify(bounds, null, 2));
    }
  };
};
