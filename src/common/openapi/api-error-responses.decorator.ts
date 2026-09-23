import { applyDecorators, HttpStatus } from '@nestjs/common';
import { ApiResponse } from '@nestjs/swagger';

import { ErrorResponseDto } from './error-response.dto';

/**
 * Documents error statuses of an operation with the shared error envelope.
 * Keys are HTTP statuses, values the cases that produce them.
 */
export function ApiErrorResponses(
  responses: Partial<Record<HttpStatus, string>>,
): MethodDecorator & ClassDecorator {
  return applyDecorators(
    ...Object.entries(responses).map(([status, description]) =>
      ApiResponse({
        status: Number(status),
        description,
        type: ErrorResponseDto,
        headers:
          Number(status) === HttpStatus.TOO_MANY_REQUESTS
            ? {
                'Retry-After': {
                  description: 'Seconds to wait before the next request.',
                  schema: { type: 'integer' },
                },
              }
            : undefined,
      }),
    ),
  );
}

export const RATE_LIMITED_DESCRIPTION =
  'More requests to this route from one client address than the rate limit allows (RATE_LIMITED).';
export const REQUEST_BODY_TOO_LARGE_DESCRIPTION =
  'The request body exceeds the size limit, 256 KB for JSON (PAYLOAD_TOO_LARGE).';
export const UNSUPPORTED_MEDIA_TYPE_DESCRIPTION =
  'An unsupported Content-Encoding or a charset that is not a UTF encoding (UNSUPPORTED_MEDIA_TYPE).';
export const DATABASE_UNAVAILABLE_DESCRIPTION =
  'PostgreSQL is unavailable (SERVICE_UNAVAILABLE).';
