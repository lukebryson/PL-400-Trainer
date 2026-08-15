/**
 * The seam between persistence and the features. Owned by the orchestrator:
 * `src/lib/store.tsx` implements it, `src/features/*` consumes it, and neither
 * side edits this file. Raise a change rather than widening it locally.
 */
import type {
  Confidence,
  Grade,
  ProgressRecord,
  Question,
  QuestionType,
  Session,
  SkillAreaKey,
} from '../types';

export interface Store {
  /** False until IndexedDB has been read. Features must not grade before this. */
  ready: boolean;
  /** Keyed by `contentHash` — never by id or array index. */
  progress: ReadonlyMap<string, ProgressRecord>;
  sessions: Session[];

  /** Applies the Leitner move, appends the attempt, and persists. */
  recordAttempt(input: {
    question: Question;
    grade: Grade;
    confidence: Confidence;
    elapsedMs: number;
  }): Promise<ProgressRecord>;

  /** The user's dispute of the bank's stated key. Null clears it. */
  setCorrection(contentHash: string, correction: string | null): Promise<void>;
  setNotes(contentHash: string, notes: string | null): Promise<void>;

  saveSession(session: Session): Promise<void>;

  /** Whole-database dump and restore, for backup across machines. */
  exportJson(): Promise<string>;
  importJson(json: string): Promise<{ imported: number; skipped: number }>;
  resetAll(): Promise<void>;
}

/** Filters for the weak-area drill. Every field is optional and ANDed. */
export interface DrillFilter {
  area?: SkillAreaKey;
  subtopic?: string;
  type?: QuestionType;
  /** Only questions answered wrongly at least twice. */
  wrongTwice?: boolean;
  /** Only questions due under the Leitner schedule. Defaults true for a session. */
  dueOnly?: boolean;
  /** Exclude self-graded cards, for a purely machine-graded session. */
  gradedOnly?: boolean;
  /** Cap the session length. */
  limit?: number;
  /** Deterministic ordering seed, so a session can be resumed identically. */
  seed?: number;
}
