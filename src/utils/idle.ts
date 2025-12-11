/**
 * Utility for using requestIdleCallback with fallback
 * 
 * This provides a consistent way to defer non-critical work across the app.
 * The polyfill is already installed in main.ts, but this utility provides
 * a cleaner API for components that need it.
 */

export function runWhenIdle(callback: () => void): void {
  const idleCallback = (window as any).requestIdleCallback || ((cb: any) => setTimeout(cb, 1));
  idleCallback(callback);
}
