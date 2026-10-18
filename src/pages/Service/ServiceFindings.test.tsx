import { servicePageTitle } from './ServiceFindings';

describe('servicePageTitle', () => {
  it('names the selected service, with its namespace when it has one', () => {
    expect(servicePageTitle()).toBe('Service');
    expect(servicePageTitle('checkout', 'shop')).toBe('Service: shop/checkout');
    expect(servicePageTitle('payments')).toBe('Service: payments');
    expect(servicePageTitle('')).toBe('Service: Unattributed (no service.name)');
  });
});
