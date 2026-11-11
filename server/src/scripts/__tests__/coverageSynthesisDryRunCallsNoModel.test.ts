import { describe, expect, it, vi } from 'vitest';
import { parseCoverageSynthesisArgs, writerModelClientFor } from '../coverageSynthesisCore';
import {
  resolveWrittenDescription,
  writerModelThroughCache,
  type StoredWrittenDescriptionDerivation,
  type WrittenDescriptionDerivationStore,
} from '../writtenDescriptionDerivationCore';

const emptyStore = (): WrittenDescriptionDerivationStore & {
  saved: StoredWrittenDescriptionDerivation[];
} => {
  const saved: StoredWrittenDescriptionDerivation[] = [];
  return {
    saved,
    find: async () => null,
    save: async (record) => {
      saved.push(record);
    },
  };
};

const subject = {
  snippets: [
    {
      text: 'The lab studies kelp forest recovery after marine heatwaves.',
      sourceName: 'yale-research-official',
    },
  ],
  entityName: 'Kelp Lab',
};

describe('writer dry run calls no model', () => {
  it('builds no model client in a dry run, even with a key present', () => {
    const create = vi.fn(() => vi.fn());
    const args = parseCoverageSynthesisArgs(['--dry-run', '--all']);
    const client = writerModelClientFor({ apply: args.apply, apiKey: 'sk-test', create });
    expect(client).toBeNull();
    expect(create).not.toHaveBeenCalled();
  });

  it('never invokes the model for a row that needs a draft when there is no client', async () => {
    const store = emptyStore();
    const resolution = await resolveWrittenDescription({ ...subject, store, drafting: null });
    expect(resolution.step).toBe('planned');
    expect(resolution.modelCalled).toBe(false);
    expect(store.saved).toEqual([]);
  });

  it('builds the client and drafts when applying', async () => {
    const model = vi.fn(async () => ({
      fullDescription: 'Studies kelp forest recovery after marine heatwaves.',
      usedSnippetIndexes: [0],
    }));
    const create = vi.fn(() => model);
    const client = writerModelClientFor({ apply: true, apiKey: 'sk-test', create });
    expect(create).toHaveBeenCalledWith('sk-test');
    const store = emptyStore();
    const resolution = await resolveWrittenDescription({
      ...subject,
      store,
      drafting: writerModelThroughCache({ callLLM: client!, store }),
    });
    expect(resolution.step).toBe('synthesized');
    expect(resolution.modelCalled).toBe(true);
    expect(model).toHaveBeenCalledTimes(1);
  });

  it('refuses an apply run with no key before any row is read', () => {
    expect(() => writerModelClientFor({ apply: true, apiKey: undefined, create: vi.fn() })).toThrow(
      'requires OPENAI_API_KEY',
    );
  });
});
