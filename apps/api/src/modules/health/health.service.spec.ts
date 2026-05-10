import { Test, TestingModule } from '@nestjs/testing';
import type { HealthCheckResponse } from '@libertasian/types';

import { HealthService } from './health.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('HealthService', () => {
  let service: HealthService;
  let prismaService: {
    $queryRaw: jest.Mock;
  };

  beforeEach(async () => {
    const mockPrismaService = {
      $queryRaw: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HealthService,
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
      ],
    }).compile();

    service = module.get<HealthService>(HealthService);
    prismaService = module.get(PrismaService) as unknown as typeof prismaService;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it("should return status 'ok' when database is up", async () => {
    // Arrange
    prismaService.$queryRaw.mockResolvedValueOnce([{ '?column?': 1 }]);

    // Act
    const result: HealthCheckResponse = await service.check();

    // Assert
    expect(result.status).toBe('ok');
    expect(result.services['database']!.status).toBe('up');
    expect(result.services['database']!.latencyMs).toBeGreaterThanOrEqual(0);
    expect(result.services['database']!.message).toBeUndefined();
    expect(prismaService.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it("should return status 'error' when database is down", async () => {
    // Arrange
    prismaService.$queryRaw.mockRejectedValueOnce(new Error('Connection refused'));

    // Act
    const result: HealthCheckResponse = await service.check();

    // Assert
    expect(result.status).toBe('error');
    expect(result.services['database']!.status).toBe('down');
    expect(result.services['database']!.message).toBe('Database connection failed');
    expect(result.services['database']!.latencyMs).toBeUndefined();
    expect(prismaService.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it('should include a valid ISO timestamp', async () => {
    // Arrange
    prismaService.$queryRaw.mockResolvedValueOnce([{ '?column?': 1 }]);
    const beforeTest = new Date();

    // Act
    const result: HealthCheckResponse = await service.check();

    // Assert
    const afterTest = new Date();
    const resultTimestamp = new Date(result.timestamp);

    // Verify it's a valid ISO string
    expect(result.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);

    // Verify the timestamp is within the test execution window
    expect(resultTimestamp.getTime()).toBeGreaterThanOrEqual(beforeTest.getTime());
    expect(resultTimestamp.getTime()).toBeLessThanOrEqual(afterTest.getTime());
  });

  it('should measure database latency accurately', async () => {
    // The service measures latency via `Date.now() - start` (1ms resolution).
    // Node's setTimeout is best-effort — `setTimeout(50)` can resolve at 49.x ms
    // on fast CI runners, producing a 49ms reading and tripping a `>= 50` floor.
    // Mock with a 75ms delay so even with timer jitter the floor is comfortably cleared.
    const SIMULATED_QUERY_MS = 75;
    const ASSERTION_FLOOR_MS = 50;

    prismaService.$queryRaw.mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, SIMULATED_QUERY_MS));
      return [{ '?column?': 1 }];
    });

    const result: HealthCheckResponse = await service.check();

    expect(result.services['database']!.status).toBe('up');
    expect(result.services['database']!.latencyMs).toBeGreaterThanOrEqual(ASSERTION_FLOOR_MS);
    expect(result.services['database']!.latencyMs).toBeLessThan(500); // Allow generous tolerance for CI/slow environments
  });

  it('should handle database errors gracefully without throwing', async () => {
    // Arrange
    prismaService.$queryRaw.mockRejectedValueOnce(new Error('Timeout'));

    // Act & Assert
    await expect(service.check()).resolves.toBeDefined();
  });
});
