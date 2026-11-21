/**
 * R: the boundaries of the infix-operator edges, each pinned as measured.
 *
 * - An operator the repository itself defines (`%in%`, `%>%`) binds like any other: the positive
 *   control for the claim that a base operator or a pipe binds nothing unless it is redefined.
 * - Two definitions of one operator name are ambiguous: the use in a third file gets no edge, and
 *   the use beside one definition keeps its local edge.
 * - A dotted operator (`%.%`, `%+.%`) links in its defining file (0.85) but across files only by
 *   the qualified-name lookup at 0.35, because the free-call lookups refuse a dotted name.
 * - A definition made through `assign()` gets no edge.
 * - A call or member call on the left-hand side keeps its own edge next to the operator's.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import path from 'path';
import { FIXTURES, getRelationships, runPipelineFromRepo } from './helpers.js';
import type { PipelineResult } from './helpers.js';

beforeAll(() => vi.stubEnv('GITNEXUS_WORKER_READY_TIMEOUT_MS', '60000'));
afterAll(() => vi.unstubAllEnvs());

describe('R infix operators: boundaries', () => {
  let result: PipelineResult;

  beforeAll(async () => {
    result = await runPipelineFromRepo(path.join(FIXTURES, 'r-infix-edge-cases'), () => {});
  }, 60000);

  /** `target:targetFile:reason:confidence` of every CALLS edge from `source`. */
  const edges = (source: string): string[] =>
    getRelationships(result, 'CALLS')
      .filter((e) => e.source === source)
      .map((e) => `${e.target}:${e.targetFilePath}:${e.rel.reason}:${e.rel.confidence}`)
      .sort();

  it('has exactly these CALLS edges', () => {
    const all = getRelationships(result, 'CALLS')
      .map((e) => `${e.source}->${e.target}`)
      .sort();
    expect(all).toEqual(
      [
        'cross_dotted->`%.%`',
        'cross_dotted_plus->`%+.%`',
        'dup_local->`%+%`',
        'lhs_call->`%||%`',
        'lhs_call->helper',
        'lhs_member->`%||%`',
        'lhs_member->bump',
        'local_dotted->`%.%`',
        'local_dotted_plus->`%+.%`',
        'redefined_in->`%in%`',
        'redefined_pipe->`%>%`',
      ].sort(),
    );
  });

  it('binds a base operator and the pipe when the repository defines them', () => {
    expect(edges('redefined_in')).toEqual(['`%in%`:R/ops.R:global-name-fallback:0.5']);
    expect(edges('redefined_pipe')).toEqual(['`%>%`:R/ops.R:global-name-fallback:0.5']);
  });

  it('binds no edge for an operator defined twice, except beside its own definition', () => {
    expect(edges('cross_ambiguous')).toEqual([]);
    expect(edges('dup_local')).toEqual(['`%+%`:R/dup.R:local-call:0.85']);
  });

  it('links a dotted operator in its defining file, and across files only at 0.35', () => {
    expect(edges('local_dotted')).toEqual(['`%.%`:R/ops.R:local-call:0.85']);
    expect(edges('local_dotted_plus')).toEqual(['`%+.%`:R/ops.R:local-call:0.85']);
    expect(edges('cross_dotted')).toEqual(['`%.%`:R/ops.R:scope-resolution: call:0.35']);
    expect(edges('cross_dotted_plus')).toEqual(['`%+.%`:R/ops.R:scope-resolution: call:0.35']);
  });

  it('does not link an operator defined through assign()', () => {
    expect(edges('cross_assigned')).toEqual([]);
  });

  it('keeps the left-hand call and the operator edge together', () => {
    expect(edges('lhs_call')).toEqual([
      '`%||%`:R/ops.R:global-name-fallback:0.5',
      'helper:R/ops.R:global-name-fallback:0.5',
    ]);
    expect(edges('lhs_member')).toEqual([
      '`%||%`:R/ops.R:global-name-fallback:0.5',
      'bump:R/ops.R:import-resolved:0.85',
    ]);
  });
});
