import { IsInt, Max, Min } from 'class-validator';

export class UpdateInflightDto {
  /**
   * New per-batch concurrency ceiling. Bounds match
   * {@link CreateBackfillBatchDto.inflightCap}: 1–200.
   *
   * Operators bump this for halted-then-resumed batches when source
   * throughput recovers, or dial it down when a batch is hammering a
   * rate-limited source. Effective on the next tick — no restart needed.
   */
  @IsInt()
  @Min(1)
  @Max(200)
  inflightCap!: number;
}
