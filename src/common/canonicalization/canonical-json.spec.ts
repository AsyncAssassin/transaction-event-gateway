import {
  hashCanonicalJson,
  serializeCanonicalJson,
} from './canonical-json';

describe('canonical JSON hashing', () => {
  it('serializes object keys in a stable recursive order', () => {
    const first = serializeCanonicalJson({
      metadata: {
        z: true,
        a: {
          y: 'yes',
          b: 'bee',
        },
      },
      amount: '125.50',
    });
    const second = serializeCanonicalJson({
      amount: '125.50',
      metadata: {
        a: {
          b: 'bee',
          y: 'yes',
        },
        z: true,
      },
    });

    expect(first).toBe(second);
    expect(first).toBe(
      '{"amount":"125.50","metadata":{"a":{"b":"bee","y":"yes"},"z":true}}',
    );
  });

  it('produces the same SHA-256 hash for logically identical JSON objects', () => {
    const firstHash = hashCanonicalJson({
      amount: '1.00',
      asset: 'USDC',
      metadata: {
        customerId: 'cust_123',
        flags: {
          vip: true,
          risk: 'low',
        },
      },
    });
    const secondHash = hashCanonicalJson({
      metadata: {
        flags: {
          risk: 'low',
          vip: true,
        },
        customerId: 'cust_123',
      },
      asset: 'USDC',
      amount: '1.00',
    });

    expect(firstHash).toBe(secondHash);
    expect(firstHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('preserves array order when hashing', () => {
    expect(hashCanonicalJson({ values: ['a', 'b'] })).not.toBe(
      hashCanonicalJson({ values: ['b', 'a'] }),
    );
  });
});
