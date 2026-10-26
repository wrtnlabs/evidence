import type {
  IEvidenceAdapter,
  IEvidenceSourceSnapshot,
} from "@wrtnlabs/evidence";

/** Pairs an adapter with a complete source snapshot for public ownership checks. */
export interface IEvidenceAdapterIsolationCase {
  /** Extraction boundary whose input and output must remain independent. */
  adapter: IEvidenceAdapter;

  /** Caller-owned source records captured before extraction begins. */
  snapshot: IEvidenceSourceSnapshot;
}
