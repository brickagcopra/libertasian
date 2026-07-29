import { PrismaService } from '../../prisma/prisma.service';
import { AudioPublishListener } from './audio-publish.listener';
import { AudioRenditionService } from './audio-rendition.service';

function build(documentType?: string) {
  const renditions = {
    isGenerationEnabled: jest.fn().mockReturnValue(true),
    requestGeneration: jest.fn().mockResolvedValue(undefined),
  };
  const prisma = {
    legalDocument: {
      findUnique: jest.fn().mockResolvedValue(
        documentType ? { documentType } : null,
      ),
    },
  };
  const listener = new AudioPublishListener(
    renditions as unknown as AudioRenditionService,
    prisma as unknown as PrismaService,
  );
  return { listener, renditions, prisma };
}

describe('AudioPublishListener', () => {
  it('resolves the document_type and passes it to the gate', async () => {
    const { listener, renditions } = build('codal');

    await listener.handleContentPublished({
      contentType: 'legal_document',
      contentId: 'doc-1',
    });

    expect(renditions.isGenerationEnabled).toHaveBeenCalledWith(
      'legal_document',
      'codal',
    );
    expect(renditions.requestGeneration).toHaveBeenCalledWith(
      'legal_document',
      'doc-1',
      'en',
    );
  });

  it('does not look up a document_type for digests', async () => {
    const { listener, renditions, prisma } = build();

    await listener.handleContentPublished({
      contentType: 'digest',
      contentId: 'digest-1',
    });

    expect(prisma.legalDocument.findUnique).not.toHaveBeenCalled();
    expect(renditions.isGenerationEnabled).toHaveBeenCalledWith('digest', undefined);
  });

  it('does not enqueue when the gate refuses', async () => {
    const { listener, renditions } = build('decision');
    renditions.isGenerationEnabled.mockReturnValue(false);

    await listener.handleContentPublished({
      contentType: 'legal_document',
      contentId: 'doc-2',
    });

    expect(renditions.requestGeneration).not.toHaveBeenCalled();
  });

  it('never lets an audio failure escape into the publish flow', async () => {
    const { listener, renditions } = build('codal');
    renditions.requestGeneration.mockRejectedValue(new Error('queue down'));

    await expect(
      listener.handleContentPublished({
        contentType: 'legal_document',
        contentId: 'doc-3',
      }),
    ).resolves.toBeUndefined();
  });
});
