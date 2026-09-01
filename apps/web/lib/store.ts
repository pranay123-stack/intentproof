import 'server-only';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { AuthorizedIntent, ExecutionReceipt } from '@intentproof/sdk';

export interface CompilerRecord {
  readonly compilerId: string;
  readonly kind: 'llm' | 'deterministic';
  readonly model: string | null;
  readonly isModelGenerated: boolean;
  readonly createdAt: string;
  readonly durationMs: number;
}

export interface StoredIntent {
  intent: AuthorizedIntent;
  receipts: ExecutionReceipt[];
  compiler: CompilerRecord;
  warnings: string[];
  /** The words the user typed, kept only so the intent page can show provenance. */
  sourceText: string;
}

interface StoreShape {
  intents: StoredIntent[];
}

const DATA_FILE = resolve(process.env.INTENTPROOF_DATA_DIR ?? '.data', 'intents.json');

/**
 * A deliberately small persistence layer.
 *
 * On a developer machine intents survive a restart, which makes the /intents and
 * /verify pages useful across sessions. On a read-only host (Vercel) the write
 * fails and the store falls back to memory for the lifetime of the instance.
 *
 * Neither case is load-bearing for correctness. Verification recomputes every
 * hash and re-runs the policy engine from the receipt itself, so a lost store
 * costs you a listing, not a proof — which is why a full database would be
 * scope this MVP does not need.
 */
class IntentStore {
  #state: StoreShape = { intents: [] };
  #persistent = true;

  constructor() {
    this.#load();
  }

  get persistent(): boolean {
    return this.#persistent;
  }

  #load(): void {
    try {
      this.#state = JSON.parse(readFileSync(DATA_FILE, 'utf8')) as StoreShape;
    } catch {
      this.#state = { intents: [] };
    }
  }

  #save(): void {
    if (!this.#persistent) return;
    try {
      mkdirSync(dirname(DATA_FILE), { recursive: true });
      writeFileSync(DATA_FILE, JSON.stringify(this.#state, null, 2), 'utf8');
    } catch {
      // Read-only filesystem: keep serving from memory rather than failing the
      // request. The user is told about this on the status endpoint.
      this.#persistent = false;
    }
  }

  nextSequence(): number {
    return this.#state.intents.length;
  }

  list(): StoredIntent[] {
    return [...this.#state.intents].sort((a, b) => b.intent.sequence - a.intent.sequence);
  }

  /** Look up by our short id, by full intent hash, or by display number. */
  find(identifier: string): StoredIntent | undefined {
    const needle = identifier.trim().toLowerCase();
    return this.#state.intents.find((record) => {
      if (record.intent.intentId.toLowerCase() === needle) return true;
      if (record.intent.intentHash.toLowerCase() === needle) return true;
      try {
        if (needle.startsWith('0x') && BigInt(needle) === BigInt(record.intent.intentHash)) {
          return true;
        }
      } catch {
        /* not a hex number; fall through */
      }
      return String(record.intent.sequence + 1).padStart(6, '0') === needle.replace(/^#/u, '');
    });
  }

  findByReceipt(receiptHash: string): { record: StoredIntent; receipt: ExecutionReceipt } | undefined {
    const needle = receiptHash.trim().toLowerCase();
    for (const record of this.#state.intents) {
      const receipt = record.receipts.find((r) => {
        if (r.receiptHash.toLowerCase() === needle) return true;
        try {
          return BigInt(r.receiptHash) === BigInt(needle);
        } catch {
          return false;
        }
      });
      if (receipt) return { record, receipt };
    }
    return undefined;
  }

  create(record: StoredIntent): StoredIntent {
    this.#state.intents.push(record);
    this.#save();
    return record;
  }

  appendReceipts(intentId: string, receipts: readonly ExecutionReceipt[]): void {
    const record = this.find(intentId);
    if (!record) return;
    record.receipts.push(...receipts);
    this.#save();
  }

  update(intentId: string, mutate: (record: StoredIntent) => void): StoredIntent | undefined {
    const record = this.find(intentId);
    if (!record) return undefined;
    mutate(record);
    this.#save();
    return record;
  }
}

/** Survives Next.js dev-server hot reloads, which otherwise reset module state. */
const globalRef = globalThis as unknown as { __intentproofStore?: IntentStore };

export function intentStore(): IntentStore {
  globalRef.__intentproofStore ??= new IntentStore();
  return globalRef.__intentproofStore;
}

export type { IntentStore };
