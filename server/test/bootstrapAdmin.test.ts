import { Types } from 'mongoose';
import { beforeAll, describe, expect, it } from 'vitest';
import { getRounds, verifyPassword } from '../src/features/auth/password.js';
import { bootstrapAdmin } from '../src/scripts/bootstrapAdmin.js';
import { Administrator, AuditLog, Employee, User } from '../src/models/index.js';
import { createAdmin, makeCredentials, randomPassword } from './helpers/fixtures.js';

const deps = { bcryptCost: 12 };
let creds: { password: string; hash: string };

beforeAll(async () => {
  creds = await makeCredentials();
});

const input = (overrides: Record<string, string> = {}) => ({
  BOOTSTRAP_ADMIN_EMAIL: 'First.Admin@Example.com',
  BOOTSTRAP_ADMIN_NAME: 'First Admin',
  BOOTSTRAP_ADMIN_PASSWORD: randomPassword(),
  ...overrides,
});

describe('bootstrapAdmin', () => {
  it('BA1: creates the first administrator with createdBy null and audits it', async () => {
    const data = input();
    const result = await bootstrapAdmin(data, deps);
    expect(result).toBe('created');

    const admin = await Administrator.findOne().select('+passwordHash');
    expect(admin).toMatchObject({ email: 'first.admin@example.com', name: 'First Admin' });
    expect(admin?.createdBy).toBeNull();
    expect(admin?.role).toBe('administrator');
    expect(getRounds(admin?.passwordHash ?? '')).toBeGreaterThanOrEqual(12);
    expect(await verifyPassword(data.BOOTSTRAP_ADMIN_PASSWORD, admin?.passwordHash ?? '')).toBe(
      true,
    );

    const entry = await AuditLog.findOne({ action: 'admin.bootstrapped' }).lean();
    expect(entry).toMatchObject({ severity: 'critical', outcome: 'success', targetType: 'user' });
    expect(JSON.stringify(entry)).not.toContain(data.BOOTSTRAP_ADMIN_PASSWORD);
  });

  it('BA2: a rerun, with the same or a different email, is skipped and changes nothing', async () => {
    const first = input();
    expect(await bootstrapAdmin(first, deps)).toBe('created');
    const before = await Administrator.findOne().select('+passwordHash').lean();

    expect(await bootstrapAdmin(first, deps)).toBe('skipped');
    expect(
      await bootstrapAdmin(
        input({
          BOOTSTRAP_ADMIN_EMAIL: 'second@example.com',
          BOOTSTRAP_ADMIN_PASSWORD: randomPassword(),
        }),
        deps,
      ),
    ).toBe('skipped');

    expect(await User.countDocuments()).toBe(1);
    const after = await Administrator.findOne().select('+passwordHash').lean();
    expect(after?.passwordHash).toBe(before?.passwordHash);
    expect(after?.email).toBe(before?.email);
    expect(await AuditLog.countDocuments({ action: 'admin.bootstrapped' })).toBe(1);
  });

  it('BA3: invalid input throws, naming the key without echoing the password', async () => {
    const weak = 'short-pw';
    let message = '';
    try {
      await bootstrapAdmin(input({ BOOTSTRAP_ADMIN_PASSWORD: weak }), deps);
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toMatch(/BOOTSTRAP_ADMIN_PASSWORD/);
    expect(message).not.toContain(weak);
    await expect(bootstrapAdmin(input({ BOOTSTRAP_ADMIN_EMAIL: 'nope' }), deps)).rejects.toThrow(
      /BOOTSTRAP_ADMIN_EMAIL/,
    );
    await expect(bootstrapAdmin({}, deps)).rejects.toThrow(/BOOTSTRAP_ADMIN_NAME/);
    expect(await User.countDocuments()).toBe(0);
  });

  it('BA4: an existing administrator causes a skip', async () => {
    await createAdmin(creds);
    expect(await bootstrapAdmin(input(), deps)).toBe('skipped');
    expect(await User.countDocuments()).toBe(1);
  });

  it('BA5: accounts without createdBy are rejected unless the bootstrap local is set', async () => {
    const base = { name: 'X', email: 'x@example.com', passwordHash: creds.hash };
    await expect(Employee.create(base)).rejects.toThrow(/createdBy/);
    await expect(Administrator.create(base)).rejects.toThrow(/createdBy/);
    await expect(Employee.create({ ...base, createdBy: null })).rejects.toThrow(/createdBy/);
    await expect(
      Employee.create({ ...base, createdBy: new Types.ObjectId() }),
    ).resolves.toBeDefined();
  });
});
