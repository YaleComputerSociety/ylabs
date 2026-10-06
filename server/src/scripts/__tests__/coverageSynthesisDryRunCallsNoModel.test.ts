import { describe, expect, it, vi } from 'vitest';
import {
  parseCoverageSynthesisArgs,
  synthesizeWithWriterModel,
  writerModelClientFor,
} from '../coverageSynthesisCore';

describe('writer dry run calls no model', () => {
  it('builds no model client in a dry run, even with a key present', () => {
    const create = vi.fn(() => vi.fn());
    const args = parseCoverageSynthesisArgs(['--dry-run', '--all']);
    const client = writerModelClientFor({ apply: args.apply, apiKey: 'sk-test', create });
    expect(client).toBeNull();
    expect(create).not.toHaveBeenCalled();
  });

  it('never invokes the model for a row planned to synthesize when there is no client', async () => {
    const model = vi.fn();
    const synthesize = vi.fn(async (callLLM: typeof model) => callLLM());
    const decision = await synthesizeWithWriterModel({
      step: 'synthesize',
      callLLM: null,
      synthesize,
    });
    expect(decision).toBeNull();
    expect(synthesize).not.toHaveBeenCalled();
    expect(model).not.toHaveBeenCalled();
  });

  it('builds the client and synthesizes when applying', async () => {
    const model = vi.fn(async () => 'written');
    const create = vi.fn(() => model);
    const client = writerModelClientFor({ apply: true, apiKey: 'sk-test', create });
    expect(create).toHaveBeenCalledWith('sk-test');
    const decision = await synthesizeWithWriterModel({
      step: 'synthesize',
      callLLM: client,
      synthesize: (callLLM) => callLLM(),
    });
    expect(decision).toBe('written');
    expect(model).toHaveBeenCalledTimes(1);
  });

  it('does not synthesize a row whose evidence is unchanged, even when applying', async () => {
    const synthesize = vi.fn();
    const decision = await synthesizeWithWriterModel({
      step: 'evidence-unchanged',
      callLLM: vi.fn(),
      synthesize,
    });
    expect(decision).toBeNull();
    expect(synthesize).not.toHaveBeenCalled();
  });

  it('refuses an apply run with no key before any row is read', () => {
    expect(() =>
      writerModelClientFor({ apply: true, apiKey: undefined, create: vi.fn() }),
    ).toThrow('requires OPENAI_API_KEY');
  });
});
