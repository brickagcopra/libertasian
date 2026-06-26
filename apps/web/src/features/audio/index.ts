export { AudioPlayer } from './components/audio-player';
export {
  ReadAlongProvider,
  useReadAlongState,
  useReadAlongPublisher,
  useActiveSegmentId,
} from './components/read-along-context';
export {
  DigestReadAlongBody,
  type DigestSectionDef,
} from './components/digest-read-along-body';
export { useAudioRendition } from './hooks/use-audio-rendition';
export { useReadAlongSegments } from './hooks/use-readalong-segments';
export { parseMarks, activeWordIndex } from './lib/parse-marks';
export { parseReadAlong, activeSegmentIndex } from './lib/parse-readalong';
export type {
  AudioContentType,
  AudioRenditionResponse,
  AudioRenditionStatus,
  ParsedMarks,
  ReadAlongKind,
  ReadAlongManifest,
  ReadAlongSegment,
  SentenceMark,
  WordMark,
} from './types';
