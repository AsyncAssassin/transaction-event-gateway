const HEX_TX_HASH_PATTERN = /^0x[0-9a-f]+$/i;

// Transaction hashes are stored and compared in one form: without surrounding
// whitespace, and with 0x-prefixed hexadecimal hashes, as used by EVM chains,
// in lowercase because hexadecimal is case-insensitive. Other formats, such as
// base58 signatures, are case-sensitive and keep their case.
export function normalizeTxHash(txHash: string): string {
  const trimmed = txHash.trim();

  return HEX_TX_HASH_PATTERN.test(trimmed) ? trimmed.toLowerCase() : trimmed;
}
