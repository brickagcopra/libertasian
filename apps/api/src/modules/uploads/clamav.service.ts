import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as net from 'net';

/**
 * ClamAV client service for malware scanning.
 * Communicates with ClamAV daemon via TCP (clamd protocol).
 *
 * Per CLAUDE.md: scan every uploaded file before processing.
 * Quarantine and reject infected files.
 */
@Injectable()
export class ClamavService {
  private readonly logger = new Logger(ClamavService.name);
  private readonly host: string;
  private readonly port: number;
  private readonly timeout: number;
  private readonly enabled: boolean;

  constructor(private readonly config: ConfigService) {
    this.host = this.config.get<string>('CLAMAV_HOST', 'localhost');
    this.port = this.config.get<number>('CLAMAV_PORT', 3310);
    this.timeout = this.config.get<number>('CLAMAV_TIMEOUT', 30000);
    this.enabled = this.config.get<string>('CLAMAV_ENABLED', 'true') === 'true';
  }

  /**
   * Scan a buffer for malware using ClamAV INSTREAM protocol.
   * Returns { clean: true } if no threats, or { clean: false, virus: string } if infected.
   *
   * If ClamAV is unavailable and CLAMAV_ENABLED=false, logs a warning and allows the upload.
   * In production, CLAMAV_ENABLED should always be true.
   */
  async scanBuffer(
    buffer: Buffer,
    filename: string,
  ): Promise<{ clean: boolean; virus?: string }> {
    if (!this.enabled) {
      this.logger.warn(
        `ClamAV scanning disabled — skipping scan for ${filename}`,
      );
      return { clean: true };
    }

    return new Promise((resolve, reject) => {
      const socket = new net.Socket();
      let response = '';

      socket.setTimeout(this.timeout);

      socket.on('connect', () => {
        // Send INSTREAM command
        socket.write('zINSTREAM\0');

        // Send data in chunks (max 2GB per ClamAV protocol)
        // Each chunk: 4-byte length (network byte order) + data
        const chunkSize = 8192;
        for (let offset = 0; offset < buffer.length; offset += chunkSize) {
          const end = Math.min(offset + chunkSize, buffer.length);
          const chunk = buffer.subarray(offset, end);
          const sizeBuffer = Buffer.alloc(4);
          sizeBuffer.writeUInt32BE(chunk.length, 0);
          socket.write(sizeBuffer);
          socket.write(chunk);
        }

        // Send zero-length chunk to signal end of stream
        const endBuffer = Buffer.alloc(4);
        endBuffer.writeUInt32BE(0, 0);
        socket.write(endBuffer);
      });

      socket.on('data', (data: Buffer) => {
        response += data.toString('utf-8');
      });

      socket.on('end', () => {
        const trimmed = response.trim().replace(/\0/g, '');

        if (trimmed.includes('OK')) {
          this.logger.debug(`ClamAV scan clean: ${filename}`);
          resolve({ clean: true });
        } else if (trimmed.includes('FOUND')) {
          // Extract virus name: "stream: VirusName FOUND"
          const match = trimmed.match(/stream:\s+(.+)\s+FOUND/);
          const virus = match ? match[1] : 'Unknown';
          this.logger.warn(
            `ClamAV detected malware in ${filename}: ${virus}`,
          );
          resolve({ clean: false, virus });
        } else if (trimmed.includes('ERROR')) {
          this.logger.error(`ClamAV scan error for ${filename}: ${trimmed}`);
          reject(new ServiceUnavailableException('Malware scan failed'));
        } else {
          this.logger.error(
            `ClamAV unexpected response for ${filename}: ${trimmed}`,
          );
          reject(new ServiceUnavailableException('Malware scan returned unexpected response'));
        }
      });

      socket.on('timeout', () => {
        socket.destroy();
        this.logger.error(`ClamAV scan timeout for ${filename}`);
        reject(new ServiceUnavailableException('Malware scan timed out'));
      });

      socket.on('error', (err: Error) => {
        this.logger.error(`ClamAV connection error: ${err.message}`);
        if (!this.enabled) {
          // Graceful degradation when explicitly disabled
          resolve({ clean: true });
        } else {
          reject(
            new ServiceUnavailableException(
              'Malware scanning service unavailable',
            ),
          );
        }
      });

      socket.connect(this.port, this.host);
    });
  }

  /**
   * Health check — ping ClamAV daemon.
   */
  async isHealthy(): Promise<boolean> {
    if (!this.enabled) return true;

    return new Promise((resolve) => {
      const socket = new net.Socket();
      socket.setTimeout(5000);

      socket.on('connect', () => {
        socket.write('zPING\0');
      });

      socket.on('data', (data: Buffer) => {
        const response = data.toString('utf-8').trim().replace(/\0/g, '');
        socket.destroy();
        resolve(response === 'PONG');
      });

      socket.on('error', () => {
        socket.destroy();
        resolve(false);
      });

      socket.on('timeout', () => {
        socket.destroy();
        resolve(false);
      });

      socket.connect(this.port, this.host);
    });
  }
}
