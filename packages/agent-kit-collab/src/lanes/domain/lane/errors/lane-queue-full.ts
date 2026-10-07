/** An idle lane was woken while every slot was taken and `maxQueued` lanes were already waiting. */
export interface LaneQueueFull {
  readonly _tag: "LaneQueueFull";
  readonly key: string;
  readonly maxQueued: number;
}
