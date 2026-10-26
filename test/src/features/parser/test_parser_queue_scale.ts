import { TestValidator } from "@nestia/e2e";
import { EvidenceParser } from "@wrtnlabs/evidence";
import type { EvidenceParseSession } from "@wrtnlabs/evidence";
import { EvidenceTestSignal } from "../../internal/EvidenceTestSignal";

/**
 * Drains a large admitted FIFO after close without retaining consumed waiters.
 *
 * Closing admission must drain all accepted callbacks in order while consumed
 * queue entries release their references.
 *
 * 1. Hold the sole parser slot and admit 2,000 waiting callbacks.
 * 2. Close admission, release the held callback and await every result.
 * 3. Require FIFO completion and zero active and waiting slots.
 *
 * @evidence contracts/testing.md#behavioral-verification Queues 2000 real parse callbacks behind one held slot, closes admission, checks exact FIFO results and verifies all active and waiting slots drain.
 * @evidence contracts/testing.md#independent-expectations One held callback owns the sole slot and every later accepted request resumes in its authored numeric order before close resolves.
 * @evidence contracts/testing.md#distinguishing-cases Covers a large queue, direct slot transfer, closed admission and final drain; lifetime tests own callback failure and disposed sessions.
 * @evidence contracts/testing.md#execution-ownership DynamicExecutor invokes the maintained parser in-process and releases its held callback and parser in finally without a subprocess or extra asset provider.
 */
export async function test_parser_queue_scale(): Promise<void> {
  const parser: EvidenceParser = new EvidenceParser({ concurrency: 1 });
  const entered: EvidenceTestSignal = new EvidenceTestSignal();
  const release: EvidenceTestSignal = new EvidenceTestSignal();
  const order: number[] = [];
  const first: Promise<number> = parser.parse(
    { type: "typescript", file: "queue.ts", content: "" },
    async (_session: EvidenceParseSession): Promise<number> => {
      entered.open();
      await release.wait;
      return -1;
    },
  );
  const jobs: Promise<number>[] = [first];
  try {
    await entered.wait;
    for (let index: number = 0; index < 2000; ++index)
      jobs.push(
        parser.parse(
          { type: "typescript", file: "queue.ts", content: "" },
          (_session: EvidenceParseSession): number => {
            order.push(index);
            return index;
          },
        ),
      );
    TestValidator.equals(
      "all queued requests retained",
      parser.state().waiting,
      2000,
    );
    const closed: Promise<void> = parser.close();
    release.open();
    await Promise.all(jobs);
    await closed;
    TestValidator.equals(
      "FIFO callback ownership",
      order,
      Array.from(
        { length: 2000 },
        (_value: unknown, index: number): number => index,
      ),
    );
    TestValidator.equals("queue drained", parser.state().waiting, 0);
    TestValidator.equals("slots released", parser.state().active, 0);
  } finally {
    release.open();
    await Promise.allSettled(jobs);
    await parser.close();
  }
}
