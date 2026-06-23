/** Content kinds that can be synthesized to audio. */
export const AUDIO_CONTENT_TYPES = ['digest', 'bar_exam_answer'] as const;
export type AudioContentType = (typeof AUDIO_CONTENT_TYPES)[number];

export function isAudioContentType(value: string): value is AudioContentType {
  return (AUDIO_CONTENT_TYPES as readonly string[]).includes(value);
}

/** BullMQ job payload for the `audio-generation` queue. */
export interface AudioGenerationJobData {
  contentType: AudioContentType;
  contentId: string;
  language: string;
  /** When true, bypass the content-hash short-circuit and re-synthesize. */
  force?: boolean;
}

/** Name of the BullMQ queue + the single job name on it. */
export const AUDIO_QUEUE = 'audio-generation';
export const AUDIO_JOB = 'generate-audio';
