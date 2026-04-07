import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { ServiceUnavailableException } from '@nestjs/common';
import { EventEmitter } from 'events';

import { ClamavService } from './clamav.service';

// Mock the net module
const mockSocket = new EventEmitter() as EventEmitter & {
  write: jest.Mock;
  destroy: jest.Mock;
  connect: jest.Mock;
  setTimeout: jest.Mock;
};
mockSocket.write = jest.fn();
mockSocket.destroy = jest.fn();
mockSocket.connect = jest.fn();
mockSocket.setTimeout = jest.fn();

jest.mock('net', () => ({
  Socket: jest.fn().mockImplementation(() => {
    // Create a fresh mock for each Socket instance
    const socket = new EventEmitter() as EventEmitter & {
      write: jest.Mock;
      destroy: jest.Mock;
      connect: jest.Mock;
      setTimeout: jest.Mock;
    };
    socket.write = jest.fn();
    socket.destroy = jest.fn();
    socket.connect = jest.fn();
    socket.setTimeout = jest.fn();
    // Store reference so tests can emit events
    (mockSocket as unknown as Record<string, unknown>)['_latest'] = socket;
    return socket;
  }),
}));

function getLatestSocket(): typeof mockSocket {
  return (mockSocket as unknown as Record<string, unknown>)['_latest'] as typeof mockSocket;
}

describe('ClamavService', () => {
  let service: ClamavService;

  const createService = async (enabled = true) => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ClamavService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string, defaultValue?: unknown) => {
              if (key === 'CLAMAV_HOST') return 'localhost';
              if (key === 'CLAMAV_PORT') return 3310;
              if (key === 'CLAMAV_TIMEOUT') return 30000;
              if (key === 'CLAMAV_ENABLED') return enabled ? 'true' : 'false';
              return defaultValue;
            }),
          },
        },
      ],
    }).compile();

    return module.get<ClamavService>(ClamavService);
  };

  beforeEach(async () => {
    service = await createService(true);
  });

  // ---- scanBuffer ----

  describe('scanBuffer', () => {
    it('should skip scan when disabled', async () => {
      const disabledService = await createService(false);
      const buffer = Buffer.from('test file content');

      const result = await disabledService.scanBuffer(buffer, 'test.pdf');
      expect(result).toEqual({ clean: true });
    });

    it('should return clean for OK response', async () => {
      const buffer = Buffer.from('test file content');

      const scanPromise = service.scanBuffer(buffer, 'test.pdf');

      // Give the promise a tick to set up
      await new Promise((r) => setTimeout(r, 0));
      const socket = getLatestSocket();

      // Simulate connection and scan response
      socket.emit('connect');
      await new Promise((r) => setTimeout(r, 0));
      socket.emit('data', Buffer.from('stream: OK\0'));
      socket.emit('end');

      const result = await scanPromise;
      expect(result).toEqual({ clean: true });
    });

    it('should return virus name for FOUND response', async () => {
      const buffer = Buffer.from('malicious content');

      const scanPromise = service.scanBuffer(buffer, 'malware.exe');

      await new Promise((r) => setTimeout(r, 0));
      const socket = getLatestSocket();

      socket.emit('connect');
      await new Promise((r) => setTimeout(r, 0));
      socket.emit('data', Buffer.from('stream: Win.Test.EICAR FOUND\0'));
      socket.emit('end');

      const result = await scanPromise;
      expect(result).toEqual({ clean: false, virus: 'Win.Test.EICAR' });
    });

    it('should reject with ServiceUnavailableException for ERROR response', async () => {
      const buffer = Buffer.from('test');

      const scanPromise = service.scanBuffer(buffer, 'test.pdf');

      await new Promise((r) => setTimeout(r, 0));
      const socket = getLatestSocket();

      socket.emit('connect');
      await new Promise((r) => setTimeout(r, 0));
      socket.emit('data', Buffer.from('ERROR: some error\0'));
      socket.emit('end');

      await expect(scanPromise).rejects.toThrow(ServiceUnavailableException);
    });

    it('should reject on timeout', async () => {
      const buffer = Buffer.from('test');

      const scanPromise = service.scanBuffer(buffer, 'test.pdf');

      await new Promise((r) => setTimeout(r, 0));
      const socket = getLatestSocket();

      socket.emit('timeout');

      await expect(scanPromise).rejects.toThrow(ServiceUnavailableException);
    });

    it('should reject on connection error when enabled', async () => {
      const buffer = Buffer.from('test');

      const scanPromise = service.scanBuffer(buffer, 'test.pdf');

      await new Promise((r) => setTimeout(r, 0));
      const socket = getLatestSocket();

      socket.emit('error', new Error('Connection refused'));

      await expect(scanPromise).rejects.toThrow(ServiceUnavailableException);
    });

    it('should resolve clean on connection error when disabled', async () => {
      const disabledService = await createService(false);
      const buffer = Buffer.from('test');

      // When disabled, scanBuffer returns early without opening socket
      const result = await disabledService.scanBuffer(buffer, 'test.pdf');
      expect(result).toEqual({ clean: true });
    });

    it('should reject with ServiceUnavailableException for unexpected response', async () => {
      const buffer = Buffer.from('test');

      const scanPromise = service.scanBuffer(buffer, 'test.pdf');

      await new Promise((r) => setTimeout(r, 0));
      const socket = getLatestSocket();

      socket.emit('connect');
      await new Promise((r) => setTimeout(r, 0));
      socket.emit('data', Buffer.from('UNEXPECTED RESPONSE\0'));
      socket.emit('end');

      await expect(scanPromise).rejects.toThrow(ServiceUnavailableException);
    });
  });

  // ---- isHealthy ----

  describe('isHealthy', () => {
    it('should return true when disabled', async () => {
      const disabledService = await createService(false);
      const result = await disabledService.isHealthy();
      expect(result).toBe(true);
    });

    it('should return true for PONG response', async () => {
      const healthPromise = service.isHealthy();

      await new Promise((r) => setTimeout(r, 0));
      const socket = getLatestSocket();

      socket.emit('connect');
      await new Promise((r) => setTimeout(r, 0));
      socket.emit('data', Buffer.from('PONG\0'));

      const result = await healthPromise;
      expect(result).toBe(true);
    });

    it('should return false on connection error', async () => {
      const healthPromise = service.isHealthy();

      await new Promise((r) => setTimeout(r, 0));
      const socket = getLatestSocket();

      socket.emit('error', new Error('Connection refused'));

      const result = await healthPromise;
      expect(result).toBe(false);
    });

    it('should return false on timeout', async () => {
      const healthPromise = service.isHealthy();

      await new Promise((r) => setTimeout(r, 0));
      const socket = getLatestSocket();

      socket.emit('timeout');

      const result = await healthPromise;
      expect(result).toBe(false);
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });
});
