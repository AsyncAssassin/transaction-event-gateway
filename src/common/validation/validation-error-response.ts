import {
  BadRequestException,
  ValidationError,
} from '@nestjs/common';

export type ValidationErrorDetail = {
  field: string;
  message: string;
};

export function flattenValidationErrors(
  errors: ValidationError[],
  parentPath = '',
): ValidationErrorDetail[] {
  return errors.flatMap((error) => {
    const fieldPath = parentPath
      ? `${parentPath}.${error.property}`
      : error.property;
    const ownDetails = Object.values(error.constraints ?? {}).map((message) => ({
      field: fieldPath,
      message,
    }));
    const childDetails = flattenValidationErrors(error.children ?? [], fieldPath);

    return [...ownDetails, ...childDetails];
  });
}

export function createValidationException(
  errors: ValidationError[],
): BadRequestException {
  return new BadRequestException({
    error: 'VALIDATION_ERROR',
    message: 'Request validation failed.',
    details: flattenValidationErrors(errors),
  });
}
