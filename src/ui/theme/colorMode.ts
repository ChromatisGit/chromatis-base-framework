import { useCallback, useSyncExternalStore } from "react";

export type ColorMode = "system" | "light" | "dark";

const changeEvent = "chromatis:color-mode-change";
const memory = new Map<string, ColorMode>();

function storedMode(storageKey: string): ColorMode {
  try {
    const value = localStorage.getItem(storageKey);
    if (value === "light" || value === "dark") {
      return value;
    }
  } catch {
    // The current page can still use an in-memory selection.
  }
  return memory.get(storageKey) ?? "system";
}

/** Run the returned script in the document head before CSS is painted. */
export function colorModeInitScript(storageKey: string): string {
  const key = JSON.stringify(storageKey).replaceAll("<", "\\u003c");
  return `try{var m=localStorage.getItem(${key});if(m==='light'||m==='dark')document.documentElement.dataset.theme=m}catch(e){}`;
}

/** The application owns the key and its theme palette; the shared hook owns mode behavior. */
export function useColorMode(
  storageKey: string,
): readonly [ColorMode, (mode: ColorMode) => void] {
  const subscribe = useCallback(
    (callback: () => void) => {
      const onChange = (event: Event) => {
        if ((event as CustomEvent<string>).detail === storageKey) {
          callback();
        }
      };
      const onStorage = (event: StorageEvent) => {
        if (event.key === storageKey) {
          memory.delete(storageKey);
          if (event.newValue === "light" || event.newValue === "dark") {
            document.documentElement.dataset.theme = event.newValue;
          } else {
            document.documentElement.removeAttribute("data-theme");
          }
          callback();
        }
      };
      window.addEventListener(changeEvent, onChange);
      window.addEventListener("storage", onStorage);
      return () => {
        window.removeEventListener(changeEvent, onChange);
        window.removeEventListener("storage", onStorage);
      };
    },
    [storageKey],
  );
  const getSnapshot = useCallback(() => storedMode(storageKey), [storageKey]);
  const mode = useSyncExternalStore<ColorMode>(
    subscribe,
    getSnapshot,
    () => "system",
  );
  const choose = useCallback(
    (next: ColorMode) => {
      memory.set(storageKey, next);
      if (next === "system") {
        document.documentElement.removeAttribute("data-theme");
      } else {
        document.documentElement.dataset.theme = next;
      }
      try {
        if (next === "system") {
          localStorage.removeItem(storageKey);
        } else {
          localStorage.setItem(storageKey, next);
        }
      } catch {
        // The current page still reflects the selection.
      }
      window.dispatchEvent(
        new CustomEvent(changeEvent, { detail: storageKey }),
      );
    },
    [storageKey],
  );
  return [mode, choose] as const;
}
