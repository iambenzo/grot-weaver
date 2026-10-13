const SERVICE_NAME_TAG = 'resource.service.name';
const PLAIN_ATTRIBUTE = /^[A-Za-z0-9_.]+$/;

export function escapeString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

export function serviceFilterExpression(serviceName: string): string {
  return `${SERVICE_NAME_TAG} = "${escapeString(serviceName)}"`;
}

export function attributeSelector(scope: 'resource' | 'span', key: string): string {
  if (PLAIN_ATTRIBUTE.test(key)) {
    return `${scope}.${key}`;
  }
  return `${scope}."${escapeString(key)}"`;
}
