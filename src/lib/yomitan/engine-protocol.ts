/** What the page posts to start the engine worker (see `engine.worker.ts`). */
export interface EngineInit {
  /** The profile persisted by the page, or undefined for Yomitan's defaults. */
  profile: unknown;
  /** One end of a MessageChannel; the worker serves `connectYomitan`'s protocol on it. */
  port: MessagePort;
}

/** What the worker posts back if it can't start. */
export interface EngineFailure {
  error: string;
}
