import type { Tournament } from '@tourney/engine';
import { CHANNEL_NAME, type MediaChannelFactory, type SnapshotMessage } from './protocol';
import { toMediaSnapshot } from './sanitize';

function isHelloMessage(message: unknown): boolean {
  return (
    typeof message === 'object' &&
    message !== null &&
    'type' in message &&
    message.type === 'hello'
  );
}

export function createMediaPublisher(
  channelFactory: MediaChannelFactory = (name) => new BroadcastChannel(name),
) {
  const channel = channelFactory(CHANNEL_NAME);
  const sessionId = globalThis.crypto.randomUUID();
  let seq = 0;
  let latest: SnapshotMessage | null = null;
  let disposed = false;

  channel.onmessage = (event) => {
    if (!disposed && isHelloMessage(event.data) && latest) {
      channel.postMessage(latest);
    }
  };

  function publish(t: Tournament | null) {
    if (disposed) return;
    if (!t) {
      latest = null;
      return;
    }
    seq += 1;
    latest = {
      type: 'snapshot',
      sessionId,
      seq,
      snapshot: toMediaSnapshot(t),
    };
    channel.postMessage(latest);
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    latest = null;
    channel.onmessage = null;
    channel.close();
  }

  return { publish, dispose };
}
