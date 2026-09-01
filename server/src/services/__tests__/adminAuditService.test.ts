import { afterEach, describe, expect, it, vi } from 'vitest';
import { AdminAuditEvent } from '../../models/adminAuditEvent';
import {
  adminAuditEventDto,
  listAdminAuditEvents,
  recordAdminAuditEvent,
} from '../adminAuditService';

const findChain = (results: unknown[]) => {
  const chain: any = {};
  chain.sort = vi.fn().mockReturnValue(chain);
  chain.skip = vi.fn().mockReturnValue(chain);
  chain.limit = vi.fn().mockReturnValue(chain);
  chain.lean = vi.fn().mockResolvedValue(results);
  return chain;
};

describe('recordAdminAuditEvent', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('writes a normalized append-only event for a valid admin mutation', async () => {
    const create = vi.spyOn(AdminAuditEvent, 'create').mockResolvedValue({} as any);

    await recordAdminAuditEvent({
      actorNetid: ' Fixture-Admin '.replace('-', ''),
      action: 'Listing.Update',
      targetType: 'listing',
      targetId: '507f1f77bcf86cd799439011',
      summary: { fields: ['title', 'description'], note: ' edited copy ' },
    });

    expect(create).toHaveBeenCalledTimes(1);
    const payload = create.mock.calls[0][0] as any;
    expect(payload.actorNetid).toBe('fixtureadmin');
    expect(payload.action).toBe('listing.update');
    expect(payload.targetType).toBe('listing');
    expect(payload.targetId).toBe('507f1f77bcf86cd799439011');
    expect(payload.summary).toEqual({ fields: ['title', 'description'], note: 'edited copy' });
    expect(payload.timestamp).toBeInstanceOf(Date);
  });

  it('does not write when the actor netid is invalid', async () => {
    const create = vi.spyOn(AdminAuditEvent, 'create').mockResolvedValue({} as any);

    await recordAdminAuditEvent({ actorNetid: 'not a netid', action: 'listing.update' });

    expect(create).not.toHaveBeenCalled();
  });

  it('does not write when the action is not a dotted slug', async () => {
    const create = vi.spyOn(AdminAuditEvent, 'create').mockResolvedValue({} as any);

    await recordAdminAuditEvent({ actorNetid: 'admin1', action: 'DROP TABLE users' });

    expect(create).not.toHaveBeenCalled();
  });

  it('is fail-soft when the audit insert rejects', async () => {
    vi.spyOn(AdminAuditEvent, 'create').mockRejectedValue(new Error('mongo down'));
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await expect(
      recordAdminAuditEvent({ actorNetid: 'admin1', action: 'listing.delete' }),
    ).resolves.toBeUndefined();

    expect(consoleError).toHaveBeenCalled();
  });
});

describe('listAdminAuditEvents', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('applies bounded filters and offset pagination', async () => {
    const chain = findChain([
      {
        _id: 'audit-1',
        actorNetid: 'admin1',
        action: 'admin_grant.revoke',
        targetType: 'adminGrant',
        targetId: 'target1',
        summary: { note: 'off-boarded' },
        timestamp: new Date('2026-01-02T00:00:00.000Z'),
      },
    ]);
    const find = vi.spyOn(AdminAuditEvent, 'find').mockReturnValue(chain as any);
    const count = vi.spyOn(AdminAuditEvent, 'countDocuments').mockResolvedValue(51 as any);

    const result = await listAdminAuditEvents({
      actor: 'Admin1',
      action: 'admin_grant.revoke',
      targetType: 'adminGrant',
      page: 3,
      pageSize: 25,
    });

    expect(find).toHaveBeenCalledWith({
      actorNetid: 'admin1',
      action: 'admin_grant.revoke',
      targetType: 'adminGrant',
    });
    expect(chain.skip).toHaveBeenCalledWith(50);
    expect(chain.limit).toHaveBeenCalledWith(25);
    expect(count).toHaveBeenCalledTimes(1);
    expect(result.total).toBe(51);
    expect(result.page).toBe(3);
    expect(result.totalPages).toBe(3);
    expect(result.events[0].action).toBe('admin_grant.revoke');
  });

  it('ignores an out-of-range pageSize and invalid actor filter', async () => {
    const chain = findChain([]);
    const find = vi.spyOn(AdminAuditEvent, 'find').mockReturnValue(chain as any);
    vi.spyOn(AdminAuditEvent, 'countDocuments').mockResolvedValue(0 as any);

    const result = await listAdminAuditEvents({ actor: 'bad netid', pageSize: 100000 });

    expect(find).toHaveBeenCalledWith({});
    expect(chain.limit).toHaveBeenCalledWith(100);
    expect(result.totalPages).toBe(1);
  });
});

describe('adminAuditEventDto', () => {
  it('bounds the summary and stringifies the id', () => {
    const dto = adminAuditEventDto({
      _id: { toString: () => 'abc123' },
      actorNetid: 'admin1',
      action: 'profile.update',
      targetType: 'profile',
      targetId: 'netid1',
      summary: { fields: ['bio'], extra: 'dropped' },
      timestamp: new Date('2026-01-01T00:00:00.000Z'),
    });

    expect(dto.id).toBe('abc123');
    expect(dto.summary).toEqual({ fields: ['bio'] });
  });
});
