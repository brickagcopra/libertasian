/**
 * Polly voice-spike — pick the production "listen" voice/engine by ear.
 *
 * Synthesizes ONE fixed legal passage across a matrix of Amazon Polly
 * voice/engine pairs so a human can A/B them. The real subject under test is
 * our legal-SSML normalizer (`toSsml`): the same SSML it produces in production
 * is what every candidate here speaks, so differences are purely voice timbre,
 * prosody, and how each engine handles `<phoneme>`/`<sub>`/`<say-as>` tags.
 *
 * This is a standalone spike, NOT wired into any NestJS module. It pulls no
 * Prisma/DB dependency — the passage is embedded below.
 *
 * Run on the production server (the only host with AWS creds):
 *   AWS_REGION=ap-southeast-1 \
 *   AWS_ACCESS_KEY_ID=... AWS_SECRET_ACCESS_KEY=... \
 *   pnpm --filter api exec ts-node scripts/voice-spike.ts
 *
 * Output: apps/api/voice-spike-out/<voice>-<engine>.mp3 (gitignored).
 * Each pair is isolated in its own try/catch — one bad pair never aborts the
 * run; failures are reported in the final summary table.
 */
import { mkdirSync, writeFileSync } from 'fs';
import * as path from 'path';

import {
  Engine,
  PollyClient,
  SynthesizeSpeechCommand,
  VoiceId,
  type SynthesizeSpeechCommandOutput,
} from '@aws-sdk/client-polly';

import { toSsml } from '../src/modules/audio/legal-ssml.util';

/**
 * Representative ~120-word passage chosen to exercise every branch of the
 * normalizer: a G.R. citation, `Sec.`/`Art.` abbreviations, a `v.` case
 * separator, and the Latin terms carried in LATIN_LEXICON.
 */
const PASSAGE = [
  'In Tañada v. Angara, the Supreme Court sitting en banc, with the ponente ' +
    'writing for the majority, reaffirmed the doctrine of stare decisis as the ' +
    'bedrock of Philippine jurisprudence.',
  'The petitioners had elevated the controversy by way of a petition for ' +
    'certiorari, invoking G.R. No. 166006 and assailing the constitutionality ' +
    'of the challenged measure.',
  'Citing Sec. 4 of the enabling statute together with Art. 1156 of the Civil ' +
    'Code, the Court held that an obligation is a juridical necessity to give, ' +
    'to do, or not to do. It stressed that prior rulings, once settled, bind ' +
    'lower courts until the same tribunal, again sitting en banc, sees fit to ' +
    'revisit and overturn them.',
].join('\n\n');

/** A single voice/engine combination to synthesize. */
interface Candidate {
  readonly voiceId: VoiceId;
  readonly engine: Engine;
}

/**
 * Candidate matrix (all en-US). Grouped by engine so the summary reads in a
 * natural order; the same passage/SSML is spoken by every entry.
 */
const CANDIDATES: readonly Candidate[] = [
  // neural
  { voiceId: VoiceId.Matthew, engine: Engine.NEURAL },
  { voiceId: VoiceId.Joanna, engine: Engine.NEURAL },
  { voiceId: VoiceId.Stephen, engine: Engine.NEURAL },
  { voiceId: VoiceId.Ruth, engine: Engine.NEURAL },
  { voiceId: VoiceId.Kevin, engine: Engine.NEURAL },
  // generative
  { voiceId: VoiceId.Matthew, engine: Engine.GENERATIVE },
  { voiceId: VoiceId.Ruth, engine: Engine.GENERATIVE },
  { voiceId: VoiceId.Danielle, engine: Engine.GENERATIVE },
  { voiceId: VoiceId.Stephen, engine: Engine.GENERATIVE },
  // long-form
  { voiceId: VoiceId.Gregory, engine: Engine.LONG_FORM },
  { voiceId: VoiceId.Ruth, engine: Engine.LONG_FORM },
  { voiceId: VoiceId.Danielle, engine: Engine.LONG_FORM },
];

/** Outcome of synthesizing one candidate. */
interface SpikeResult {
  readonly voiceId: VoiceId;
  readonly engine: Engine;
  readonly ok: boolean;
  readonly bytes: number;
  readonly error?: string;
}

const OUTPUT_DIR = path.resolve(__dirname, '..', 'voice-spike-out');

/** Read a required env var or fail fast with a clear message. */
function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing required env var ${name}. Set AWS_REGION, AWS_ACCESS_KEY_ID, ` +
        'and AWS_SECRET_ACCESS_KEY before running this spike.',
    );
  }
  return value;
}

/** Synthesize one candidate and write its mp3. Throws on any failure. */
async function synthesize(
  client: PollyClient,
  ssml: string,
  candidate: Candidate,
): Promise<number> {
  const output: SynthesizeSpeechCommandOutput = await client.send(
    new SynthesizeSpeechCommand({
      Text: ssml,
      TextType: 'ssml',
      OutputFormat: 'mp3',
      VoiceId: candidate.voiceId,
      Engine: candidate.engine,
    }),
  );

  if (!output.AudioStream) {
    throw new Error('Polly returned no AudioStream');
  }

  const audio = await output.AudioStream.transformToByteArray();
  const fileName = `${candidate.voiceId}-${candidate.engine}.mp3`;
  writeFileSync(path.join(OUTPUT_DIR, fileName), audio);
  return audio.byteLength;
}

/** Render the per-candidate outcomes as a fixed-width summary table. */
function printSummary(results: readonly SpikeResult[]): void {
  const voiceWidth = Math.max(5, ...results.map((r) => r.voiceId.length));
  const engineWidth = Math.max(6, ...results.map((r) => r.engine.length));
  const header =
    `${'VOICE'.padEnd(voiceWidth)}  ${'ENGINE'.padEnd(engineWidth)}  ` +
    `${'STATUS'.padEnd(6)}  BYTES`;

  console.log(`\n${header}`);
  console.log('-'.repeat(header.length));
  for (const r of results) {
    const status = r.ok ? 'ok' : 'failed';
    const detail = r.ok ? String(r.bytes) : (r.error ?? 'unknown error');
    console.log(
      `${r.voiceId.padEnd(voiceWidth)}  ${r.engine.padEnd(engineWidth)}  ` +
        `${status.padEnd(6)}  ${detail}`,
    );
  }

  const okCount = results.filter((r) => r.ok).length;
  console.log(
    `\n${okCount}/${results.length} pairs synthesized into ${OUTPUT_DIR}`,
  );
}

async function main(): Promise<void> {
  const region = requireEnv('AWS_REGION');
  // Presence-checked so the run fails fast with guidance rather than an opaque
  // AWS credential error on the first send(). The SDK reads them from env.
  requireEnv('AWS_ACCESS_KEY_ID');
  requireEnv('AWS_SECRET_ACCESS_KEY');

  mkdirSync(OUTPUT_DIR, { recursive: true });

  const { ssml, normalizedText } = toSsml(PASSAGE);
  console.log('Normalized spoken text:\n');
  console.log(normalizedText);
  console.log('\nSSML fed to Polly:\n');
  console.log(ssml);
  console.log(`\nSynthesizing ${CANDIDATES.length} voice/engine pairs...\n`);

  const client = new PollyClient({ region });
  const results: SpikeResult[] = [];

  for (const candidate of CANDIDATES) {
    const label = `${candidate.voiceId}/${candidate.engine}`;
    try {
      const bytes = await synthesize(client, ssml, candidate);
      console.log(`${label} ok: ${bytes} bytes`);
      results.push({ ...candidate, ok: true, bytes });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`${label} FAILED: ${message}`);
      results.push({ ...candidate, ok: false, bytes: 0, error: message });
    }
  }

  printSummary(results);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`voice-spike aborted: ${message}`);
  process.exitCode = 1;
});
