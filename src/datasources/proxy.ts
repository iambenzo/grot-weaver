import { Subscription } from 'rxjs';
import { BackendSrvRequest, getBackendSrv, getDataSourceSrv } from '@grafana/runtime';

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

export function fetchData<T>(request: BackendSrvRequest, signal?: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError());
      return;
    }
    let subscription: Subscription | undefined;
    let last: { value: T } | undefined;
    const onAbort = () => {
      subscription?.unsubscribe();
      reject(abortError());
    };
    const settle = (finish: () => void) => {
      signal?.removeEventListener('abort', onAbort);
      finish();
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    subscription = getBackendSrv()
      .fetch<T>(request)
      .subscribe({
        next: (response) => {
          last = { value: response.data };
        },
        error: (error: unknown) => settle(() => reject(error)),
        complete: () =>
          settle(() => (last ? resolve(last.value) : reject(new Error(`no response from ${request.url}`)))),
      });
  });
}

export function createProxyGet(signal?: AbortSignal): ProxyGet {
  return <T>(uid: string, path: string, params: Record<string, string>, headers: Record<string, string> = {}) =>
    fetchData<T>(
      {
        url: `/api/datasources/proxy/uid/${encodeURIComponent(uid)}${path}`,
        params,
        headers,
        method: 'GET',
        showErrorAlert: false,
        showSuccessAlert: false,
      },
      signal
    );
}

export const proxyGet: ProxyGet = createProxyGet();

export function discoverDatasources(types: string[]): DatasourceRef[] {
  return getDataSourceSrv()
    .getList({ type: types })
    .filter((settings) => types.includes(settings.type))
    .map((settings) => ({ uid: settings.uid, type: settings.type, name: settings.name }));
}
