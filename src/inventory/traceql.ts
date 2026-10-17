import { ServiceRef } from './types';

export type { ServiceRef };

const SERVICE_NAME_TAG = 'resource.service.name';
const SERVICE_NAMESPACE_TAG = 'resource.service.namespace';
const PLAIN_ATTRIBUTE = /^[A-Za-z0-9_.]+$/;

export function escapeString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

export function serviceFilterExpression(service: ServiceRef): string {
  const byName = `${SERVICE_NAME_TAG} = "${escapeString(service.name)}"`;
  if (service.namespace === undefined) {
    return byName;
  }
  if (service.namespace === '') {
    return `${byName} && ${SERVICE_NAMESPACE_TAG} = nil`;
  }
  return `${byName} && ${SERVICE_NAMESPACE_TAG} = "${escapeString(service.namespace)}"`;
}

export function attributeSelector(scope: 'resource' | 'span', key: string): string {
  if (PLAIN_ATTRIBUTE.test(key)) {
    return `${scope}.${key}`;
  }
  return `${scope}."${escapeString(key)}"`;
}
