/**
 * FIFO admission queue for the lifetime of parser extraction callbacks.
 *
 * Acquire reserves ownership until the caller releases it in cleanup. Closing
 * rejects new requests while allowing already queued requests to drain, so the
 * parser runtime can wait for all accepted native-resource owners to finish.
 *
 * @evidence contracts/common.md#principled-implementation A FIFO semaphore with ownership transfer bounds concurrent native parser callbacks and lets close wait for accepted work to drain.
 * @evidence contracts/common.md#clear-and-simple-design The class manages admission only; parser sessions are owned by EvidenceParser.
 * @evidence contracts/common.md#prohibited-implementation-shortcuts Release transfers a slot directly to the next waiter so close never observes a false zero.
 * @evidence contracts/common.md#meaningful-documentation The class comment explains acquire, release and close semantics; every field and method is documented.
 * @evidence contracts/performance.md#efficient-algorithms Acquire and release are O(1) except Array.shift on the waiter queue.
 * @evidenceExclude contracts/performance.md#reuse-equivalent-work The queue coordinates admission, not results; there is no computed work to share.
 * @evidence contracts/performance.md#bound-retention-and-release-resources Active slots are bounded by the configured limit, waiters by accepted requests, and drain resolvers are cleared once the last owner releases.
 */
export class EvidenceParserSlots {
  /**
   * Number of reserved slots, including slots transferred to queued requests.
   *
   * A transfer keeps this count unchanged until the receiving request releases
   * it.
   */
  public active = 0;

  /**
   * Whether admission has closed to new requests.
   *
   * Accepted requests may still be active or queued while close waits for
   * drainage.
   */
  public closed = false;

  /**
   * Resolvers waiting for ownership in arrival order.
   *
   * Releasing a slot wakes the oldest request before reducing the active count.
   */
  private readonly queue: Array<(() => void) | undefined> = [];

  /** First live waiter; consumed slots release their resolver immediately. */
  private head: number = 0;

  /**
   * Close callers waiting for the final reserved slot to be released.
   *
   * Retaining all resolvers makes repeated concurrent close calls await one
   * drain.
   */
  private readonly drains: (() => void)[] = [];

  /**
   * Creates an empty queue with the parser runtime's validated concurrency
   * limit.
   *
   * Validation belongs to the public parser options boundary; this queue only
   * manages ownership and assumes a positive integer limit.
   */
  public constructor(
    /**
     * Maximum simultaneously reserved slots.
     *
     * Requests beyond this bound wait until an existing owner releases its
     * slot.
     */
    private readonly limit: number,
  ) {}

  /**
   * Counts accepted requests that do not yet own a slot.
   *
   * Runtime state inspection uses this separately from the active reservation
   * count.
   */
  public get waiting(): number {
    return this.queue.length - this.head;
  }

  /**
   * Reserves an available slot or waits for FIFO ownership transfer.
   *
   * Requests arriving after close reject immediately. A request accepted before
   * close still resumes and must eventually call release exactly once.
   *
   * @evidence contracts/common.md#principled-implementation A free slot is taken immediately; otherwise the caller waits on a resolver queued in arrival order.
   * @evidence contracts/common.md#clear-and-simple-design Acquire only reserves; the caller releases in cleanup.
   * @evidence contracts/common.md#prohibited-implementation-shortcuts Requests after close reject immediately instead of being queued.
   * @evidence contracts/common.md#meaningful-documentation The comment states the close behavior and the release obligation.
   * @evidence contracts/performance.md#efficient-algorithms O(1) to reserve or enqueue.
   * @evidenceExclude contracts/performance.md#reuse-equivalent-work Each request needs its own slot.
   * @evidence contracts/performance.md#bound-retention-and-release-resources A reserved slot stays held until the caller's release; a queued resolver is removed when ownership transfers.
   */
  public async acquire(): Promise<void> {
    if (this.closed) throw new Error("The parser runtime is closed.");
    if (this.active < this.limit) {
      ++this.active;
      return;
    }
    const pending: Promise<void> = new Promise((resolve) => {
      this.queue.push(resolve);
    });
    await pending;
  }

  /**
   * Relinquishes one acquired slot and advances accepted work.
   *
   * The caller must have acquired ownership. Once no queued successor or active
   * owner remains, every pending close operation is released.
   *
   * @evidence contracts/common.md#principled-implementation Release hands the slot to the oldest waiter without decrementing active, otherwise decrements and wakes drains at zero.
   * @evidence contracts/common.md#clear-and-simple-design Release owns transfer and drain signaling.
   * @evidence contracts/common.md#prohibited-implementation-shortcuts Ownership transfer avoids a transient zero that close could misread.
   * @evidence contracts/common.md#meaningful-documentation The comment states the precondition and drain behavior; the inline comment explains the transfer.
   * @evidence contracts/performance.md#efficient-algorithms O(1) using a head cursor with direct ownership transfer.
   * @evidenceExclude contracts/performance.md#reuse-equivalent-work Release coordinates ownership, not results.
   * @evidence contracts/performance.md#bound-retention-and-release-resources It returns the caller's slot exactly once and empties the drain list when no owner remains.
   */
  public release(): void {
    const next: (() => void) | undefined = this.queue[this.head];
    if (this.head < this.queue.length) this.queue[this.head++] = undefined;
    if (this.head === this.queue.length) {
      this.queue.length = 0;
      this.head = 0;
    }
    // Transfer ownership without lowering active: close must not observe a
    // temporary zero while an already accepted request is about to resume.
    if (next !== undefined) next();
    else {
      --this.active;
      if (this.active === 0) for (const drain of this.drains.splice(0)) drain();
    }
  }

  /**
   * Stops new admission and waits for every accepted request to release
   * ownership.
   *
   * Call this outside an owned slot; awaiting close while holding a slot would
   * wait for the caller's own release.
   *
   * @evidence contracts/common.md#principled-implementation Close sets the closed flag, then waits for the active count to reach zero through a drain resolver.
   * @evidence contracts/common.md#clear-and-simple-design Close only stops admission and waits; owners release their own slots.
   * @evidence contracts/common.md#prohibited-implementation-shortcuts Accepted requests still drain instead of being cancelled.
   * @evidence contracts/common.md#meaningful-documentation The comment warns against calling close while holding a slot.
   * @evidence contracts/performance.md#efficient-algorithms O(1) to register a drain resolver.
   * @evidence contracts/performance.md#reuse-equivalent-work Concurrent close calls all wait on the same drain.
   * @evidence contracts/performance.md#bound-retention-and-release-resources Drain resolvers are released and cleared when the final slot is returned.
   */
  public async close(): Promise<void> {
    this.closed = true;
    if (this.active === 0) return;
    const pending: Promise<void> = new Promise((resolve) => {
      this.drains.push(resolve);
    });
    await pending;
  }
}
