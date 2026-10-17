import { getBackendSrv, getDataSourceSrv } from '@grafana/runtime';

export interface DatasourceRef {
  uid: string;
  type: string;
  name: string;
}

export type ProxyGet = <T>(
  uid: string,
  path: string,
  params: Record<string, string>,
  headers?: Record<string, string>
) => Promise<T>;

export function abortError(): Error {
  return new DOMException('The assessment was superseded', 'AbortError');
}

export function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

export function createProxyGet(signal?: AbortSignal): ProxyGet {
  return <T>(uid: string, path: string, params: Record<string, string>, headers: Record<string, string> = {}) =>
    new Promise<T>((resolve, reject) => {
      if (signal?.aborted) {
        reject(abortError());
        return;
      }
      const onAbort = () => {
        subscription.unsubscribe();
        reject(abortError());
      };
      const detach = () => signal?.removeEventListener('abort', onAbort);
      const subscription = getBackendSrv()
        .fetch<T>({
          url: `/api/datasources/proxy/uid/${encodeURIComponent(uid)}${path}`,
          params,
          headers,
          method: 'GET',
          showErrorAlert: false,
          showSuccessAlert: false,
        })
        .subscribe({
          next: (response) => {
            detach();
            resolve(response.data);
          },
          error: (error: unknown) => {
            detach();
            reject(error);
          },
          complete: () => {
            detach();
            reject(new Error(`no response from ${path}`));
          },
        });
      signal?.addEventListener('abort', onAbort, { once: true });
    });
}

export const proxyGet: ProxyGet = createProxyGet();

export function discoverDatasources(types: string[]): DatasourceRef[] {
  return getDataSourceSrv()
    .getList({ type: types })
    .filter((settings) => types.includes(settings.type))
    .map((settings) => ({ uid: settings.uid, type: settings.type, name: settings.name }));
}
