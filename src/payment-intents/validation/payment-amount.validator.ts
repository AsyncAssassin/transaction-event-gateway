import {
  registerDecorator,
  ValidationArguments,
  ValidationOptions,
} from 'class-validator';

const DECIMAL_STRING_PATTERN = /^(?:0|[1-9]\d*)(?:\.\d+)?$/;
const NUMERIC_36_18_INTEGER_DIGITS = 18;
const NUMERIC_36_18_FRACTIONAL_DIGITS = 18;

export function isValidPaymentAmount(value: unknown): value is string {
  if (typeof value !== 'string' || !DECIMAL_STRING_PATTERN.test(value)) {
    return false;
  }

  const [integerPart, fractionalPart = ''] = value.split('.');

  if (fractionalPart.length > NUMERIC_36_18_FRACTIONAL_DIGITS) {
    return false;
  }

  const significantIntegerDigits = integerPart.replace(/^0+/, '').length;
  if (significantIntegerDigits > NUMERIC_36_18_INTEGER_DIGITS) {
    return false;
  }

  return /[1-9]/.test(integerPart) || /[1-9]/.test(fractionalPart);
}

export function IsPaymentAmount(
  validationOptions?: ValidationOptions,
): PropertyDecorator {
  return (target, propertyKey) => {
    registerDecorator({
      name: 'isPaymentAmount',
      target: target.constructor,
      propertyName: String(propertyKey),
      options: validationOptions,
      validator: {
        validate(value: unknown): boolean {
          return isValidPaymentAmount(value);
        },
        defaultMessage(args: ValidationArguments): string {
          return `${args.property} must be a decimal string greater than zero and fit numeric(36,18)`;
        },
      },
    });
  };
}
