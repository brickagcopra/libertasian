import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const mockUploadMutate = vi.fn();
const mockDeleteMutate = vi.fn();

vi.mock('../hooks/use-feed-media', () => ({
  useUploadFeedMedia: () => ({
    mutate: mockUploadMutate,
    isPending: false,
  }),
  useFeedMediaStatus: () => ({
    data: null,
  }),
  useDeleteFeedMedia: () => ({
    mutate: mockDeleteMutate,
  }),
}));

vi.mock('./media-processing-badge', () => ({
  MediaProcessingBadge: () => <div data-testid="processing-badge" />,
}));

import { ImageUploader } from './image-uploader';

describe('ImageUploader', () => {
  const defaultProps = {
    mediaId: null as string | null,
    onMediaIdChange: vi.fn(),
  };

  beforeEach(() => vi.clearAllMocks());

  it('renders drop zone when no media uploaded', () => {
    render(<ImageUploader {...defaultProps} />);
    expect(screen.getByText('Click or drag an image here')).toBeInTheDocument();
    expect(screen.getByText('JPEG, PNG, or WebP up to 20MB')).toBeInTheDocument();
  });

  it('has a hidden file input', () => {
    const { container } = render(<ImageUploader {...defaultProps} />);
    const input = container.querySelector('input[type="file"]');
    expect(input).toBeTruthy();
    expect(input?.className).toContain('hidden');
  });

  it('validates file size - rejects files over 20MB', () => {
    const { container } = render(<ImageUploader {...defaultProps} />);
    const input = container.querySelector('input[type="file"]')!;

    const bigFile = new File(['x'.repeat(100)], 'big.jpg', { type: 'image/jpeg' });
    Object.defineProperty(bigFile, 'size', { value: 25 * 1024 * 1024 });

    fireEvent.change(input, { target: { files: [bigFile] } });
    expect(screen.getByText('Image must be under 20MB.')).toBeInTheDocument();
    expect(mockUploadMutate).not.toHaveBeenCalled();
  });

  it('validates file type - rejects non-image files', () => {
    const { container } = render(<ImageUploader {...defaultProps} />);
    const input = container.querySelector('input[type="file"]')!;

    const textFile = new File(['hello'], 'doc.txt', { type: 'text/plain' });
    fireEvent.change(input, { target: { files: [textFile] } });
    expect(screen.getByText('Only JPEG, PNG, and WebP images are allowed.')).toBeInTheDocument();
  });

  it('calls upload mutation for valid image file', () => {
    const { container } = render(<ImageUploader {...defaultProps} />);
    const input = container.querySelector('input[type="file"]')!;

    const validFile = new File(['img-data'], 'photo.jpg', { type: 'image/jpeg' });
    Object.defineProperty(validFile, 'size', { value: 1024 * 1024 });

    fireEvent.change(input, { target: { files: [validFile] } });
    expect(mockUploadMutate).toHaveBeenCalledOnce();
  });

  it('shows remove button when media is uploaded', () => {
    // Simulate having a preview via mediaId
    URL.createObjectURL = vi.fn(() => 'blob:test');
    const { container } = render(
      <ImageUploader mediaId="media-1" onMediaIdChange={vi.fn()} />,
    );
    // No preview URL set internally but mediaId is truthy, should show remove state
    // The component checks previewUrl || mediaId
    expect(container.querySelector('button')).toBeTruthy();
  });

  it('calls onMediaIdChange(null) and deleteMedia on remove', () => {
    const onMediaIdChange = vi.fn();
    render(<ImageUploader mediaId="media-1" onMediaIdChange={onMediaIdChange} />);
    // Find the remove button (destructive variant)
    const removeBtn = screen.getByRole('button');
    fireEvent.click(removeBtn);
    expect(mockDeleteMutate).toHaveBeenCalledWith('media-1');
    expect(onMediaIdChange).toHaveBeenCalledWith(null);
  });
});
