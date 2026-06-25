export { AudioModule, LEGAL_SSML_NORMALIZER } from './audio.module';
export { AudioController } from './audio.controller';
export { AudioGenerationProcessor } from './audio-generation.processor';
export {
  AudioRenditionService,
  type AudioRenditionReadModel,
} from './audio-rendition.service';
export {
  AUDIO_CONTENT_TYPES,
  AUDIO_JOB,
  AUDIO_QUEUE,
  isAudioContentType,
  type AudioContentType,
  type AudioGenerationJobData,
} from './audio.types';
export {
  LATIN_LEXICON,
  toSsml,
  toSsmlDocument,
  type LatinTerm,
  type SpokenDocument,
  type SsmlResult,
  type ToSsmlOptions,
} from './legal-ssml.util';
export { PollyClient, type SynthesisResult } from './polly.client';
