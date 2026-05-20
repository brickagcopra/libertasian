import { Test, TestingModule } from '@nestjs/testing';
import type { Request } from 'express';

import { PrismaService } from '../../prisma/prisma.service';
import { LoginEventService } from './login-event.service';

jest.mock('geoip-lite', () => ({
  __esModule: false,
  lookup: jest.fn(),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const geoip = require('geoip-lite') as { lookup: jest.Mock };

function buildReq(overrides: Partial<Request> = {}): Request {
  return {
    ip: '203.0.113.5',
    headers: { 'user-agent': 'Mozilla/5.0 TestAgent' },
    ...overrides,
  } as unknown as Request;
}

describe('LoginEventService', () => {
  let service: LoginEventService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      loginEvent: { create: jest.fn().mockResolvedValue({}) },
      user: { update: jest.fn().mockResolvedValue({}) },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LoginEventService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<LoginEventService>(LoginEventService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('persists event with geo data when geoip-lite finds a hit', async () => {
    geoip.lookup.mockReturnValueOnce({
      country: 'PH',
      region: 'NCR',
      city: 'Manila',
      ll: [14.5995, 120.9842],
    });

    await service.record('login_success', 'user-1', buildReq(), {
      deviceFingerprint: 'fp-1',
    });

    expect(geoip.lookup).toHaveBeenCalledWith('203.0.113.5');
    expect(prisma.loginEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'user-1',
        eventType: 'login_success',
        ipAddress: '203.0.113.5',
        userAgent: 'Mozilla/5.0 TestAgent',
        country: 'PH',
        region: 'NCR',
        city: 'Manila',
        latitude: 14.5995,
        longitude: 120.9842,
        deviceFingerprint: 'fp-1',
        failureReason: null,
      }),
    });
    // login_success also updates User.lastLogin*
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: expect.objectContaining({
        lastLoginIp: '203.0.113.5',
        lastLoginCountry: 'PH',
        lastLoginAt: expect.any(Date),
      }),
    });
  });

  it('persists event with null geo when geoip-lite returns null', async () => {
    geoip.lookup.mockReturnValueOnce(null);

    await service.record('login_success', 'user-1', buildReq());

    expect(prisma.loginEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        country: null,
        region: null,
        city: null,
        latitude: null,
        longitude: null,
      }),
    });
  });

  it('skips geoip lookup and writes null geo when IP is missing', async () => {
    await service.record(
      'login_success',
      'user-1',
      buildReq({ ip: undefined as unknown as string }),
    );

    expect(geoip.lookup).not.toHaveBeenCalled();
    expect(prisma.loginEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        ipAddress: null,
        country: null,
      }),
    });
  });

  it('writes null userAgent when header is missing', async () => {
    geoip.lookup.mockReturnValueOnce({ country: 'US' });

    await service.record(
      'token_refresh',
      'user-1',
      buildReq({ headers: {} as Request['headers'] }),
    );

    expect(prisma.loginEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userAgent: null,
      }),
    });
  });

  it('strips IPv4-mapped IPv6 prefix before geo lookup', async () => {
    geoip.lookup.mockReturnValueOnce({ country: 'JP' });

    await service.record(
      'login_success',
      'user-1',
      buildReq({ ip: '::ffff:1.2.3.4' }),
    );

    expect(geoip.lookup).toHaveBeenCalledWith('1.2.3.4');
    expect(prisma.loginEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ ipAddress: '1.2.3.4' }),
    });
  });

  it('does not update User.lastLogin* for non-success event types', async () => {
    geoip.lookup.mockReturnValueOnce({ country: 'PH' });

    await service.record('logout', 'user-1', buildReq());

    expect(prisma.loginEvent.create).toHaveBeenCalled();
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('continues (returns null geo) when geoip throws', async () => {
    geoip.lookup.mockImplementationOnce(() => {
      throw new Error('geo died');
    });

    await service.record('login_success', 'user-1', buildReq());

    expect(prisma.loginEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        country: null,
        region: null,
        city: null,
      }),
    });
  });

  it('rejects (so caller .catch fires) when the DB write fails', async () => {
    geoip.lookup.mockReturnValueOnce(null);
    prisma.loginEvent.create.mockRejectedValueOnce(new Error('db down'));

    await expect(
      service.record('login_success', 'user-1', buildReq()),
    ).rejects.toThrow('db down');
  });
});
