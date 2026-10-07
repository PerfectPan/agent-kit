/**
 * `idle`: nothing runs and nothing is owed. `queued`: woken while every slot was taken, waiting for one. `running`: one
 * activation runs.
 */
export type LaneState = "idle" | "queued" | "running";

export interface LaneSnapshot {
  readonly key: string;
  readonly state: LaneState;
  /**
   * A wake that no started activation has served yet: always set while `queued`, and set while `running` when a wake
   * arrived after the activation started, so one more activation follows it.
   */
  readonly pending: boolean;
}
