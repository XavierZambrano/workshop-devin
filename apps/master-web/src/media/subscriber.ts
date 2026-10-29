import {
  CHANNEL_NAME,
  type MediaChannelFactory,
  type MediaSnapshot,
  type SnapshotMessage,
} from './protocol';

function isSnapshotMessage(message: unknown): message is SnapshotMessage {
  if (typeof message !== 'object' || message === null) return false;
  if (!('type' in message) || message.type !== 'snapshot') return false;
  if (!('sessionId' in message) || typeof message.sessionId !== 'string') return false;
  if (!('seq' in message) || typeof message.seq !== 'number' || !Number.isFinite(message.seq)) {
    return false;
  }
  if (!('snapshot' in message) || typeof message.snapshot !== 'object' || message.snapshot === null) {
    return false;
  }
  return true;
}

export function createMediaSubscriber(
  onSnapshot: (snapshot: MediaSnapshot) => void,
  channelFactory: MediaChannelFactory = (name) => new BroadcastChannel(name),
) {
  const channel = channelFactory(CHANNEL_NAME);
  let sessionId: string | null = null;
  let lastSeq = -1;
  let disposed = false;

  channel.onmessage = (event) => {
    if (disposed || !isSnapshotMessage(event.data)) return;
    if (event.data.sessionId !== sessionId) {
      sessionId = event.data.sessionId;
      lastSeq = -1;
    }
    if (event.data.seq <= lastSeq) return;
    lastSeq = event.data.seq;
    onSnapshot(event.data.snapshot);
  };

  channel.postMessage({ type: 'hello' });

  function dispose() {
    if (disposed) return;
    disposed = true;
    channel.onmessage = null;
    channel.close();
  }

  return { dispose };
}
