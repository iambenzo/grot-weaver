import { lastValueFrom } from 'rxjs';
import { getBackendSrv } from '@grafana/runtime';
import pluginJson from '../plugin.json';
import { Signal } from './types';

export interface ProductRequirement {
  signal: Signal;
  attribute: string;
  alternatives?: string[];
  level: 'required' | 'recommended';
  source: string;
}

export interface Product {
  id: string;
  name: string;
  summary: string;
  requirements: ProductRequirement[];
}

export type FetchProducts = () => Promise<Product[]>;

export const fetchProducts: FetchProducts = async () => {
  const response = await lastValueFrom(
    getBackendSrv().fetch<Product[]>({
      url: `/api/plugins/${pluginJson.id}/resources/products`,
      method: 'GET',
      showErrorAlert: false,
    })
  );
  return response.data;
};

export function metricProductAttributes(products: Product[]): string[] {
  return [
    ...new Set(
      products.flatMap((product) =>
        product.requirements
          .filter((requirement) => requirement.signal === 'metrics')
          .flatMap((requirement) => [requirement.attribute, ...(requirement.alternatives ?? [])])
      )
    ),
  ];
}
