import { ServiceRef } from './types';

export type Volumes = Map<string, Map<string, number>>;

export function addVolume(volumes: Volumes, name: string, namespace: string, amount: number) {
  const byNamespace = volumes.get(name) ?? new Map<string, number>();
  byNamespace.set(namespace, (byNamespace.get(namespace) ?? 0) + amount);
  volumes.set(name, byNamespace);
}

export function volumeOf(volumes: Volumes, service: ServiceRef): number | undefined {
  const byNamespace = volumes.get(service.name);
  if (!byNamespace) {
    return undefined;
  }
  if (service.namespace !== undefined) {
    return byNamespace.get(service.namespace);
  }
  return [...byNamespace.values()].reduce((total, amount) => total + amount, 0);
}
