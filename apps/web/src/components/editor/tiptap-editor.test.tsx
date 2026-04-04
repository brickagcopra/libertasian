import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

// Mock tiptap
const mockChain = {
  focus: vi.fn().mockReturnThis(),
  toggleBold: vi.fn().mockReturnThis(),
  toggleItalic: vi.fn().mockReturnThis(),
  toggleUnderline: vi.fn().mockReturnThis(),
  toggleStrike: vi.fn().mockReturnThis(),
  toggleHeading: vi.fn().mockReturnThis(),
  toggleBulletList: vi.fn().mockReturnThis(),
  toggleOrderedList: vi.fn().mockReturnThis(),
  toggleBlockquote: vi.fn().mockReturnThis(),
  toggleCodeBlock: vi.fn().mockReturnThis(),
  setHorizontalRule: vi.fn().mockReturnThis(),
  extendMarkRange: vi.fn().mockReturnThis(),
  setLink: vi.fn().mockReturnThis(),
  unsetLink: vi.fn().mockReturnThis(),
  undo: vi.fn().mockReturnThis(),
  redo: vi.fn().mockReturnThis(),
  run: vi.fn(),
};

const mockEditor = {
  chain: vi.fn(() => mockChain),
  isActive: vi.fn(() => false),
  can: vi.fn(() => ({ undo: () => true, redo: () => true })),
  getAttributes: vi.fn(() => ({})),
  getJSON: vi.fn(() => ({ type: 'doc', content: [] })),
  isEditable: true,
  setEditable: vi.fn(),
};

vi.mock('@tiptap/react', () => ({
  useEditor: vi.fn(() => mockEditor),
  EditorContent: ({ editor }: { editor: unknown }) =>
    editor ? <div data-testid="editor-content">Editor</div> : null,
}));

vi.mock('@tiptap/starter-kit', () => ({
  default: { configure: vi.fn().mockReturnThis() },
}));
vi.mock('@tiptap/extension-underline', () => ({ default: {} }));
vi.mock('@tiptap/extension-link', () => ({
  default: { configure: vi.fn().mockReturnThis() },
}));
vi.mock('@tiptap/extension-placeholder', () => ({
  default: { configure: vi.fn().mockReturnThis() },
}));
vi.mock('@tiptap/extension-code-block-lowlight', () => ({
  default: { configure: vi.fn().mockReturnThis() },
}));
vi.mock('lowlight', () => ({
  common: {},
  createLowlight: vi.fn(() => ({})),
}));

import { TiptapEditor, TiptapViewer } from './tiptap-editor';

describe('TiptapEditor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEditor.isEditable = true;
    mockEditor.isActive.mockReturnValue(false);
    mockEditor.can.mockReturnValue({ undo: () => true, redo: () => true });
  });

  it('renders editor content', () => {
    render(<TiptapEditor />);
    expect(screen.getByTestId('editor-content')).toBeTruthy();
  });

  it('shows toolbar when editable', () => {
    render(<TiptapEditor editable={true} />);
    expect(screen.getByTitle('Bold')).toBeTruthy();
    expect(screen.getByTitle('Italic')).toBeTruthy();
    expect(screen.getByTitle('Underline')).toBeTruthy();
  });

  it('hides toolbar when not editable', () => {
    render(<TiptapEditor editable={false} />);
    expect(screen.queryByTitle('Bold')).toBeNull();
  });

  it('renders all heading buttons', () => {
    render(<TiptapEditor />);
    expect(screen.getByTitle('Heading 1')).toBeTruthy();
    expect(screen.getByTitle('Heading 2')).toBeTruthy();
    expect(screen.getByTitle('Heading 3')).toBeTruthy();
  });

  it('renders list buttons', () => {
    render(<TiptapEditor />);
    expect(screen.getByTitle('Bullet List')).toBeTruthy();
    expect(screen.getByTitle('Ordered List')).toBeTruthy();
  });

  it('renders block element buttons', () => {
    render(<TiptapEditor />);
    expect(screen.getByTitle('Blockquote')).toBeTruthy();
    expect(screen.getByTitle('Code Block')).toBeTruthy();
    expect(screen.getByTitle('Horizontal Rule')).toBeTruthy();
  });

  it('renders link button', () => {
    render(<TiptapEditor />);
    expect(screen.getByTitle('Link')).toBeTruthy();
  });

  it('renders undo/redo buttons', () => {
    render(<TiptapEditor />);
    expect(screen.getByTitle('Undo')).toBeTruthy();
    expect(screen.getByTitle('Redo')).toBeTruthy();
  });

  it('calls toggleBold when Bold clicked', () => {
    render(<TiptapEditor />);
    fireEvent.click(screen.getByTitle('Bold'));
    expect(mockChain.toggleBold).toHaveBeenCalled();
    expect(mockChain.run).toHaveBeenCalled();
  });

  it('calls toggleItalic when Italic clicked', () => {
    render(<TiptapEditor />);
    fireEvent.click(screen.getByTitle('Italic'));
    expect(mockChain.toggleItalic).toHaveBeenCalled();
  });

  it('calls toggleHeading when H1 clicked', () => {
    render(<TiptapEditor />);
    fireEvent.click(screen.getByTitle('Heading 1'));
    expect(mockChain.toggleHeading).toHaveBeenCalled();
  });

  it('calls undo when Undo clicked', () => {
    render(<TiptapEditor />);
    fireEvent.click(screen.getByTitle('Undo'));
    expect(mockChain.undo).toHaveBeenCalled();
  });

  it('calls redo when Redo clicked', () => {
    render(<TiptapEditor />);
    fireEvent.click(screen.getByTitle('Redo'));
    expect(mockChain.redo).toHaveBeenCalled();
  });

  it('disables undo when not available', () => {
    mockEditor.can.mockReturnValue({ undo: () => false, redo: () => true });
    render(<TiptapEditor />);
    expect(screen.getByTitle('Undo')).toHaveProperty('disabled', true);
  });

  it('applies custom className', () => {
    const { container } = render(<TiptapEditor className="my-custom" />);
    expect(container.firstElementChild?.classList.contains('my-custom')).toBe(true);
  });
});

describe('TiptapViewer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEditor.isEditable = true;
  });

  it('renders editor content', () => {
    render(<TiptapViewer content={{ type: 'doc', content: [] }} />);
    expect(screen.getByTestId('editor-content')).toBeTruthy();
  });

  it('does not show toolbar', () => {
    render(<TiptapViewer content={{ type: 'doc', content: [] }} />);
    expect(screen.queryByTitle('Bold')).toBeNull();
  });
});
