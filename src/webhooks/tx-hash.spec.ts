import { normalizeTxHash } from './tx-hash';

describe('normalizeTxHash', () => {
  it.each([
    ['0xABCDEF0123456789', '0xabcdef0123456789'],
    ['0XAbCdEf01', '0xabcdef01'],
    ['  0xabcdef01\t\n', '0xabcdef01'],
    ['0xabcdef01', '0xabcdef01'],
    // Not hexadecimal after the prefix: the case is kept.
    ['0xNotHex-ABC', '0xNotHex-ABC'],
    // Base58 signatures are case-sensitive.
    [
      '5VERv8NMvzbJMEkV8xnrLkEaWRtSz9CosKDYjCJjBRnbJLgp8uirBgmQpjKhoR4tjF3ZpRzrFmBV6UjKdiSZkQUW',
      '5VERv8NMvzbJMEkV8xnrLkEaWRtSz9CosKDYjCJjBRnbJLgp8uirBgmQpjKhoR4tjF3ZpRzrFmBV6UjKdiSZkQUW',
    ],
    [' ABCDEF ', 'ABCDEF'],
  ])('normalizes %p to %p', (txHash, expected) => {
    expect(normalizeTxHash(txHash)).toBe(expected);
  });
});
