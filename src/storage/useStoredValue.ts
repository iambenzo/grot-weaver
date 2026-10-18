import { useState } from 'react';

export function browserStorage(): Storage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

function readStored(key: string): string | undefined {
  try {
    return browserStorage()?.getItem(key) ?? undefined;
  } catch {
    return undefined;
  }
}

function writeStored(key: string, value: string) {
  try {
    browserStorage()?.setItem(key, value);
  } catch {
    return;
  }
}

export function useStoredValue(key: string): [string | undefined, (value: string) => void] {
  const [value, setValue] = useState<string | undefined>(() => readStored(key));
  const store = (next: string) => {
    setValue(next);
    writeStored(key, next);
  };
  return [value, store];
}
