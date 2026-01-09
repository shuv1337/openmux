import type net from 'net';
import { Effect, Stream } from 'effect';
import type { Buffer } from 'buffer';

import type { ShimHeader } from '../protocol';
import type { FrameReader } from '../protocol';

type FrameHandler = (header: ShimHeader, payloads: Buffer[]) => void;

export function createSocketDataStream(
  client: net.Socket,
  frameReader: FrameReader,
  handleFrame: FrameHandler
): Stream.Stream<Buffer> {
  return Stream.async<Buffer>((emit) => {
    const handleData = (chunk: Buffer) => {
      void emit.single(chunk);
    };
    client.on('data', handleData);
    return Effect.sync(() => {
      client.off('data', handleData);
    });
  }).pipe(
    Stream.tap((chunk) =>
      Effect.sync(() => {
        frameReader.feed(chunk, handleFrame);
      })
    )
  );
}
