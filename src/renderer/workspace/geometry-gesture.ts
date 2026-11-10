import type { AppCommand } from '../../shared/app-contracts.ts';

export interface FrameScheduler { request(callback: () => void): number; cancel(id: number): void }

/** Coordinates are screen DIP, so moving the native view does not change the origin. */
export function geometryGesture(options: {
  roomId: string; gestureId: string; kind: 'move' | 'resize'; x: number; y: number;
  send(command: AppCommand): unknown; frames: FrameScheduler;
}) {
  const { roomId, gestureId, frames, send } = options;
  let frame: number | undefined;
  let dx = 0, dy = 0, sentX = 0, sentY = 0, ended = false;
  send({ type: 'geometryBegin', roomId, gestureId, kind: options.kind });
  function flush() {
    frame = undefined;
    if (dx === sentX && dy === sentY) return;
    send({ type: 'geometryDelta', roomId, gestureId, dx, dy });
    sentX = dx; sentY = dy;
  }
  return {
    move(x: number, y: number) {
      if (ended || !Number.isFinite(x) || !Number.isFinite(y)) return;
      dx = x - options.x; dy = y - options.y;
      if (frame === undefined) frame = frames.request(flush);
    },
    end() {
      if (ended) return;
      ended = true;
      if (frame !== undefined) frames.cancel(frame);
      flush();
      send({ type: 'geometryEnd', roomId, gestureId });
    },
  };
}
