import { describe, expect, it, vi } from 'vitest';
import { classifyOffCampusAddressing, type DohResponse } from '../publicDnsResolution';

const A = 1;
const AAAA = 28;
const CNAME = 5;

const answering =
  (byType: Record<string, DohResponse>) =>
  async (url: string): Promise<DohResponse> => {
    const type = new URL(url).searchParams.get('type') ?? '';
    return byType[type] ?? { Status: 0, Answer: [] };
  };

describe('classifyOffCampusAddressing', () => {
  it('calls a split-horizon host public when public DNS returns a routable address', async () => {
    const query = answering({
      A: {
        Status: 0,
        Answer: [
          { type: CNAME, data: 'web2.example.edu.' },
          { type: A, data: '128.36.0.109' },
        ],
      },
    });
    await expect(classifyOffCampusAddressing('web.example.edu', query)).resolves.toBe('public');
  });

  it('confirms a host public DNS also maps into private space', async () => {
    const query = answering({ A: { Status: 0, Answer: [{ type: A, data: '10.66.3.117' }] } });
    await expect(classifyOffCampusAddressing('web.example.edu', query)).resolves.toBe(
      'private-address',
    );
  });

  it('confirms a name public DNS has never heard of', async () => {
    const query = answering({ A: { Status: 3 } });
    await expect(classifyOffCampusAddressing('web.example.internal', query)).resolves.toBe(
      'private-address',
    );
  });

  it('falls through to AAAA when the name has no A record', async () => {
    const query = answering({
      A: { Status: 0, Answer: [] },
      AAAA: { Status: 0, Answer: [{ type: AAAA, data: '2607:f8b0:4004:800::200e' }] },
    });
    await expect(classifyOffCampusAddressing('v6.example.edu', query)).resolves.toBe('public');
  });

  it('keeps the private answer when public DNS cannot be asked', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const failing = async (): Promise<DohResponse> => ({ Status: 2 });
    await expect(classifyOffCampusAddressing('web.example.edu', failing)).resolves.toBe(
      'private-address',
    );
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it('asks public DNS once per host however many pages cite it', async () => {
    const query = vi.fn(
      answering({ A: { Status: 0, Answer: [{ type: A, data: '128.36.0.109' }] } }),
    );
    await expect(classifyOffCampusAddressing('cached.example.edu', query)).resolves.toBe('public');
    await expect(classifyOffCampusAddressing('Cached.example.edu', query)).resolves.toBe('public');
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('classifies an address literal without asking anyone', async () => {
    const query = vi.fn();
    await expect(classifyOffCampusAddressing('10.1.2.3', query)).resolves.toBe('private-address');
    await expect(classifyOffCampusAddressing('128.36.0.109', query)).resolves.toBe('public');
    expect(query).not.toHaveBeenCalled();
  });
});
