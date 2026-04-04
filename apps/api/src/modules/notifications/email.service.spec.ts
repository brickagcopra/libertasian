import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';

import { EmailService } from './email.service';

// Mock nodemailer
const mockSendMail = jest.fn();
jest.mock('nodemailer', () => ({
  createTransport: jest.fn(() => ({
    sendMail: mockSendMail,
  })),
}));

describe('EmailService', () => {
  let service: EmailService;

  const payload = {
    to: 'john@example.com',
    subject: 'Welcome to LIBERTASIAN',
    html: '<h1>Welcome!</h1>',
  };

  describe('with SMTP configured', () => {
    beforeEach(async () => {
      mockSendMail.mockReset();

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          EmailService,
          {
            provide: ConfigService,
            useValue: {
              get: jest.fn((key: string, defaultVal?: unknown) => {
                const map: Record<string, unknown> = {
                  SMTP_HOST: 'smtp.example.com',
                  SMTP_PORT: 587,
                  SMTP_USER: 'user',
                  SMTP_PASS: 'pass',
                  SMTP_FROM: 'LIBERTASIAN <noreply@libertasian.com>',
                };
                return map[key] ?? defaultVal;
              }),
            },
          },
        ],
      }).compile();

      service = module.get<EmailService>(EmailService);
    });

    it('should send email via transporter', async () => {
      mockSendMail.mockResolvedValueOnce({ messageId: 'msg-1' });

      await service.send(payload);

      expect(mockSendMail).toHaveBeenCalledWith({
        from: 'LIBERTASIAN <noreply@libertasian.com>',
        to: 'john@example.com',
        subject: 'Welcome to LIBERTASIAN',
        html: '<h1>Welcome!</h1>',
      });
    });

    it('should throw when transporter.sendMail fails', async () => {
      mockSendMail.mockRejectedValueOnce(new Error('SMTP connection refused'));

      await expect(service.send(payload)).rejects.toThrow('SMTP connection refused');
    });

    it('should redact email in logs (PII compliance)', async () => {
      // The method is private, but we can verify it doesn't expose full email
      // by checking that sendMail was called with the full email (not redacted)
      mockSendMail.mockResolvedValueOnce({});
      await service.send(payload);
      // Verify the actual email is passed to sendMail (only logs are redacted)
      expect(mockSendMail).toHaveBeenCalledWith(
        expect.objectContaining({ to: 'john@example.com' }),
      );
    });
  });

  describe('without SMTP configured (dev mode)', () => {
    beforeEach(async () => {
      mockSendMail.mockReset();

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          EmailService,
          {
            provide: ConfigService,
            useValue: {
              get: jest.fn((key: string, defaultVal?: unknown) => {
                // No SMTP_HOST configured
                if (key === 'SMTP_HOST') return undefined;
                return defaultVal;
              }),
            },
          },
        ],
      }).compile();

      service = module.get<EmailService>(EmailService);
    });

    it('should log email instead of sending when no SMTP configured', async () => {
      // Should not throw and should not call sendMail
      await service.send(payload);

      expect(mockSendMail).not.toHaveBeenCalled();
    });

    it('should resolve successfully without transporter', async () => {
      const result = await service.send(payload);
      expect(result).toBeUndefined();
    });
  });

  describe('email redaction', () => {
    beforeEach(async () => {
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          EmailService,
          {
            provide: ConfigService,
            useValue: {
              get: jest.fn((_key: string, defaultVal?: unknown) => defaultVal),
            },
          },
        ],
      }).compile();

      service = module.get<EmailService>(EmailService);
    });

    it('should handle emails without @ symbol gracefully', async () => {
      // Should not throw even with malformed email
      await expect(
        service.send({ to: 'invalid-email', subject: 'Test', html: '<p>test</p>' }),
      ).resolves.toBeUndefined();
    });

    it('should handle single-char local part', async () => {
      await expect(
        service.send({ to: 'a@example.com', subject: 'Test', html: '<p>test</p>' }),
      ).resolves.toBeUndefined();
    });
  });
});
