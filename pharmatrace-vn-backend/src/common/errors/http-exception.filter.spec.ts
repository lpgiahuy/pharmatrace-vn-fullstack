import { ArgumentsHost, ForbiddenException, ServiceUnavailableException } from '@nestjs/common';
import { AppException } from './app-exception';
import { HttpExceptionFilter, validationException } from './http-exception.filter';

function run(exception: unknown) {
  const json = jest.fn();
  const response = { status: jest.fn().mockReturnValue({ json }) };
  const host = { switchToHttp: () => ({ getResponse: () => response }) } as unknown as ArgumentsHost;
  new HttpExceptionFilter().catch(exception, host);
  return { status: response.status.mock.calls[0][0] as number, body: json.mock.calls[0][0] as Record<string, unknown> };
}

describe('HttpExceptionFilter', () => {
  beforeEach(() => jest.spyOn(console, 'error').mockImplementation(() => undefined));

  it('keeps business error codes, messages and details', () => {
    const { status, body } = run(new AppException('RMA_QUANTITY_EXCEEDED', 'You can return at most 2.', 422, { max: 2 }));
    expect(status).toBe(422);
    expect(body).toEqual(expect.objectContaining({ success: false, code: 'RMA_QUANTITY_EXCEEDED', message: 'You can return at most 2.', details: { max: 2 } }));
    expect(body.traceId).toEqual(expect.any(String));
  });

  it('adds a default code to framework errors', () => {
    expect(run(new ForbiddenException('No access')).body).toEqual(expect.objectContaining({ code: 'FORBIDDEN', message: 'No access' }));
  });

  it('lists each invalid field', () => {
    const { body } = run(validationException([{ property: 'lines', children: [{ property: '0', children: [{ property: 'quantity', constraints: { min: 'Return quantity must be greater than 0.' } }] }] }]));
    expect(body).toEqual(expect.objectContaining({ code: 'VALIDATION_FAILED', message: 'Return quantity must be greater than 0.', errors: [{ field: 'lines.0.quantity', message: 'Return quantity must be greater than 0.' }] }));
  });

  it('reports each distinct validation message once', () => {
    const { body } = run(validationException([{ property: 'id', constraints: { isInt: 'Product is invalid.', min: 'Product is invalid.' } }]));
    expect(body).toEqual(expect.objectContaining({ message: 'Product is invalid.', errors: [{ field: 'id', message: 'Product is invalid.' }] }));
  });

  it('hides server internals behind a generic message', () => {
    for (const error of [new Error('relation "x" does not exist'), new ServiceUnavailableException('Order RLS setup is not ready')]) {
      const { status, body } = run(error);
      expect(status).toBeGreaterThanOrEqual(500);
      expect(body).toEqual(expect.objectContaining({ code: 'INTERNAL_ERROR', message: 'Something went wrong on our side. Please try again in a few minutes.' }));
    }
  });
});
