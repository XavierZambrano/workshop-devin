import { readFile, readdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  addPlayer,
  createTournament,
  disqualifyPlayer,
  issuePenalty,
  issueWarning,
} from '@tourney/engine';
import { describe, expect, it } from 'vitest';
import { createMediaPublisher } from '../src/media/publisher';
import { toMediaSnapshot } from '../src/media/sanitize';
import { CHANNEL_NAME, type MediaChannelFactory, type MediaChannelLike, type MediaSnapshot } from '../src/media/protocol';
import { createMediaSubscriber } from '../src/media/subscriber';

class FakeChannel implements MediaChannelLike {
  onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
  closed = false;

  constructor(
    readonly name: string,
    private readonly bus: FakeBus,
  ) {}

  postMessage(message: unknown) {
    this.bus.dispatch(this, message);
  }

  close() {
    this.closed = true;
  }
}

class FakeBus {
  channels: FakeChannel[] = [];
  readonly factory: MediaChannelFactory = (name) => {
    const channel = new FakeChannel(name, this);
    this.channels.push(channel);
    return channel;
  };

  dispatch(sender: FakeChannel, message: unknown) {
    for (const channel of this.channels) {
      if (channel !== sender && channel.name === sender.name && !channel.closed) {
        channel.onmessage?.({ data: message } as MessageEvent<unknown>);
      }
    }
  }
}

function tournament(name: string) {
  return addPlayer(createTournament({ name, format: 'SWISS', randomSeed: 1 }), 'Alice');
}

function tournamentWithSensitiveData() {
  let t = createTournament({ name: 'Public Event', format: 'SWISS', randomSeed: 1 });
  t = addPlayer(t, 'Public Player');
  t = addPlayer(t, 'Disqualified Player');
  t = issueWarning(t, {
    playerId: t.players[0]!.id,
    reason: 'SECRET_WARNING_REASON',
    notes: 'SECRET_WARNING_NOTE',
  });
  t = issuePenalty(t, {
    playerId: t.players[0]!.id,
    type: 'CUSTOM',
    reason: 'SECRET_PENALTY_REASON',
    notes: 'SECRET_PENALTY_NOTE',
  });
  t = disqualifyPlayer(t, t.players[1]!.id, 'SECRET_DQ_REASON', 'SECRET_DQ_NOTE');
  return t;
}

async function filesUnder(directory: string): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await filesUnder(path)));
    } else if (entry.isFile() && !/\.(?:test|spec)\.[cm]?[jt]sx?$/.test(entry.name)) {
      files.push(path);
    }
  }
  return files;
}

describe('media channel', () => {
  it('keeps multiple subscribers in sync with panel publishes', () => {
    const bus = new FakeBus();
    const publisher = createMediaPublisher(bus.factory);
    let first: MediaSnapshot | undefined;
    let second: MediaSnapshot | undefined;
    const subscriberA = createMediaSubscriber((snapshot) => (first = snapshot), bus.factory);
    const subscriberB = createMediaSubscriber((snapshot) => (second = snapshot), bus.factory);

    publisher.publish(tournament('First'));
    const latest = tournament('Latest');
    publisher.publish(latest);

    expect(first).toEqual(toMediaSnapshot(latest));
    expect(second).toEqual(toMediaSnapshot(latest));
    publisher.dispose();
    subscriberA.dispose();
    subscriberB.dispose();
  });

  it('replays the latest state to a subscriber that opens later', () => {
    const bus = new FakeBus();
    const publisher = createMediaPublisher(bus.factory);
    const latest = tournament('Latest');
    publisher.publish(tournament('Earlier'));
    publisher.publish(latest);
    let received: MediaSnapshot | undefined;

    const subscriber = createMediaSubscriber((snapshot) => (received = snapshot), bus.factory);

    expect(received).toEqual(toMediaSnapshot(latest));
    publisher.dispose();
    subscriber.dispose();
  });

  it('ignores stale sequence numbers and accepts a new publisher session', () => {
    const bus = new FakeBus();
    const received: MediaSnapshot[] = [];
    const subscriber = createMediaSubscriber((snapshot) => received.push(snapshot), bus.factory);
    const sender = bus.factory(CHANNEL_NAME);
    const first = toMediaSnapshot(tournament('Session One'));
    const second = toMediaSnapshot(tournament('Session Two'));

    sender.postMessage({ type: 'snapshot', sessionId: 'panel-a', seq: 2, snapshot: first });
    sender.postMessage({ type: 'snapshot', sessionId: 'panel-a', seq: 1, snapshot: second });
    sender.postMessage({ type: 'snapshot', sessionId: 'panel-b', seq: 1, snapshot: second });
    sender.postMessage({ type: 'snapshot', sessionId: 'panel-b', seq: 1, snapshot: first });

    expect(received).toEqual([first, second]);
    subscriber.dispose();
    sender.close();
  });

  it('omits arbitration notes and reasons while retaining disqualified players', () => {
    const t = tournamentWithSensitiveData();
    const snapshot = toMediaSnapshot(t);
    const serialized = JSON.stringify(snapshot);

    for (const secret of [
      'SECRET_WARNING_REASON',
      'SECRET_WARNING_NOTE',
      'SECRET_PENALTY_REASON',
      'SECRET_PENALTY_NOTE',
      'SECRET_DQ_REASON',
      'SECRET_DQ_NOTE',
    ]) {
      expect(serialized).not.toContain(secret);
    }
    expect(snapshot.players).toContainEqual(
      expect.objectContaining({ displayName: 'Disqualified Player', status: 'DISQUALIFIED' }),
    );
    expect(snapshot).not.toHaveProperty('events');
    expect(snapshot).not.toHaveProperty('history');
    expect(snapshot).not.toHaveProperty('warnings');
    expect(snapshot).not.toHaveProperty('penalties');
  });

  it('keeps every media module independent from app persistence', async () => {
    const mediaDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '../src/media');
    const files = await filesUnder(mediaDirectory);
    const forbiddenImport = /from\s+['"](?:\.\.\/store|\.\.\/db|zustand|dexie)['"]/;

    for (const file of files) {
      expect(await readFile(file, 'utf8')).not.toMatch(forbiddenImport);
    }
  });

  it('closes channels and removes message listeners on dispose', () => {
    const bus = new FakeBus();
    const publisher = createMediaPublisher(bus.factory);
    const subscriber = createMediaSubscriber(() => undefined, bus.factory);
    const [publisherChannel, subscriberChannel] = bus.channels;

    expect(publisherChannel?.onmessage).not.toBeNull();
    expect(subscriberChannel?.onmessage).not.toBeNull();
    publisher.dispose();
    subscriber.dispose();

    expect(publisherChannel?.closed).toBe(true);
    expect(subscriberChannel?.closed).toBe(true);
    expect(publisherChannel?.onmessage).toBeNull();
    expect(subscriberChannel?.onmessage).toBeNull();
  });
});
