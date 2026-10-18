import { servicePageTitle } from './ServiceFindings';

describe('servicePageTitle', () => {
  it('names the resolved owner the way the picker does', () => {
    expect(servicePageTitle()).toBe('Service');
    expect(servicePageTitle({ kind: 'service', namespace: 'shop', name: 'checkout' })).toBe('Service: shop/checkout');
    expect(servicePageTitle({ kind: 'service', name: 'payments' })).toBe('Service: payments');
    expect(servicePageTitle({ kind: 'unattributed', name: 'host-7' })).toBe('Service: Unattributed (no service.name)');
  });
});
