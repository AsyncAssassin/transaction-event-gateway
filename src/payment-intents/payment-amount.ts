// PostgreSQL returns numeric(36,18) values with all 18 fractional digits
// ("125.500000000000000000"), and clients may send trailing zeros ("125.50").
// Responses use the shortest exact decimal form of the value: "125.5", "100".
export function toCanonicalAmount(amount: string): string {
  const [integerPart, fractionalPart = ''] = amount.split('.');
  const integer = integerPart.replace(/^0+(?=\d)/, '');
  const fraction = fractionalPart.replace(/0+$/, '');

  return fraction ? `${integer}.${fraction}` : integer;
}
