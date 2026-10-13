import { lastValueFrom } from 'rxjs';
import { getBackendSrv, getDataSourceSrv } from '@grafana/runtime';

export interface DatasourceRef {
  uid: string;
  type: string;
  name: string;
}

export type ProxyGet = <T>(uid: string, path: string, params: Record<string, string>, headers?: Record<string, string>) => Promise<T>;

export const proxyGet: ProxyGet = async <T>(
  uid: string,
  path: string,
  params: Record<string, string>,
  headers: Record<string, string> = {}
) => {
  const response = await lastValueFrom(
    getBackendSrv().fetch<T>({
      url: `/api/datasources/proxy/uid/${encodeURIComponent(uid)}${path}`,
      params,
      headers,
      method: 'GET',
      showErrorAlert: false,
      showSuccessAlert: false,
    })
  );
  return response.data;
};

export function discoverDatasources(types: string[]): DatasourceRef[] {
  return getDataSourceSrv()
    .getList({ type: types })
    .filter((settings) => types.includes(settings.type))
    .map((settings) => ({ uid: settings.uid, type: settings.type, name: settings.name }));
}
