import { describe, expect, it } from 'vitest';
import { clientErrorMessage } from '../clientErrorMessage';

const axiosError = (status: number, data: Record<string, unknown>) => ({
  response: { status, data },
});

describe('clientErrorMessage', () => {
  it('shows a bounded server message for a client error', () => {
    expect(
      clientErrorMessage(axiosError(400, { error: 'Invalid department name' }), 'Failed to add'),
    ).toBe('Invalid department name');
  });

  it('falls back to the message field when no error field is present', () => {
    expect(
      clientErrorMessage(axiosError(409, { message: 'Research area already exists' }), 'Failed'),
    ).toBe('Research area already exists');
  });

  it('shows the local fallback instead of generic server text for a server error', () => {
    expect(
      clientErrorMessage(
        axiosError(500, { error: 'Internal server error' }),
        'Failed to update department',
      ),
    ).toBe('Failed to update department');
  });

  it('shows the local fallback when a server message looks sensitive', () => {
    expect(
      clientErrorMessage(axiosError(400, { error: 'mongodb://user:pass@host' }), 'Failed'),
    ).toBe('Failed');
  });

  it('shows the local fallback when there is no response', () => {
    expect(clientErrorMessage(new Error('Network Error'), 'Failed to add')).toBe('Failed to add');
  });
});
