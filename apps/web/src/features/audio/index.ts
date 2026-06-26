export { AudioPlayer } from './components/audio-player';
export { ReadAlongPanel } from './components/read-along-panel';
export { useAudioRendition } from './hooks/use-audio-rendition';
export { useReadAlongSync } from './hooks/use-read-along-sync';
export { parseMarks, activeWordIndex } from './lib/parse-marks';
export type {
  AudioContentType,
  AudioRenditionResponse,
  AudioRenditionStatus,
  ParsedMarks,
  SentenceMark,
  WordMark,
} from './types';
