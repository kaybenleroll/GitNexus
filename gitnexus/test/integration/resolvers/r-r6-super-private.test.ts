/**
 * R6: `super$m()` and `private$m()` inside a method.
 *
 * `super` reads the parents' members (private ones too), nearest parent first, and never the
 * class's own. `private` reads the class's own private members and nothing inherited. A call that
 * finds no member, or a class with no indexed parent, adds no edge and records a suppressed
 * outcome; a free function of the same name is never reached. A function that binds `super` or
 * `private` itself (a formal, a loop variable, an assignment) owns the name untyped.
 *
 * Fixture `r-r6-super-private/R/`: a three-level chain `SpBase` (base.R) <- `SpMid` (mid.R) <-
 * `SpChild` (child.R), free-function decoys of the member names in base.R, another class with a
 * private method of the same name (other.R, with a class whose parent is not indexed and one with
 * no parent) and the shadowing cases (shadow.R).
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import path from 'path';
import {
  FIXTURES,
  getRelationships,
  getResolutionOutcomes,
  runPipelineFromRepo,
  type PipelineResult,
} from './helpers.js';

beforeAll(() => vi.stubEnv('GITNEXUS_WORKER_READY_TIMEOUT_MS', '60000'));
afterAll(() => vi.unstubAllEnvs());

let result: PipelineResult;
beforeAll(async () => {
  result = await runPipelineFromRepo(path.join(FIXTURES, 'r-r6-super-private'), () => {});
}, 120000);

const callsFrom = (source: string, file: string): string[] =>
  getRelationships(result, 'CALLS')
    .filter((e) => e.source === source && e.sourceFilePath === file)
    .map((e) => `${e.rel.targetId}:${e.rel.reason}:${e.rel.confidence}`)
    .sort();

/** `line:kind:reason` of every outcome recorded at a call of `name` in `file`. */
const outcomesAt = (file: string, name: string): string[] =>
  getResolutionOutcomes(result)
    .flatMap((o) =>
      (o.kind === 'resolved' || o.kind === 'suppressed') && o.filePath === file && o.name === name
        ? [`${o.range.startLine}:${o.kind}:${o.kind === 'suppressed' ? o.reason : ''}`]
        : [],
    )
    .sort();

describe('R6 super$m() binds the nearest ancestor that defines m', () => {
  it.each([
    [
      'initialize, parent in another file, free decoy of the name',
      'initialize',
      'R/child.R',
      'Method:R/base.R:SpBase.initialize#0:import-resolved:0.85',
    ],
    [
      'the nearest of two ancestors that define the method',
      'sp_run_hello',
      'R/child.R',
      'Method:R/mid.R:SpMid.sp_hello#0:import-resolved:0.85',
    ],
    [
      'a method only the root defines, two levels up',
      'sp_run_deep',
      'R/child.R',
      'Method:R/base.R:SpBase.sp_deep#0:import-resolved:0.85',
    ],
    [
      "a parent's private method (R6 super exposes it)",
      'sp_run_pbase',
      'R/child.R',
      'Method:R/base.R:SpBase.sp_pbase#0:import-resolved:0.85',
    ],
    [
      'from the middle class',
      'sp_mid_run',
      'R/mid.R',
      'Method:R/base.R:SpBase.sp_deep#0:import-resolved:0.85',
    ],
  ])('%s', (_label, source, file, expected) => {
    expect(callsFrom(source, file)).toEqual([expected]);
  });

  it('a closure inside a method reads the same super', () => {
    expect(callsFrom('f', 'R/shadow.R')).toEqual([
      'Method:R/base.R:SpBase.sp_deep#0:import-resolved:0.85',
    ]);
  });
});

describe('R6 private$m() binds the private list of the enclosing class only', () => {
  it.each([
    ['an own private method, a decoy free function', 'sp_run_helper', 'R/child.R'],
    ['a private method calling another through private$', 'sp_private_chain', 'R/child.R'],
  ])('%s', (_label, source, file) => {
    expect(callsFrom(source, file)).toEqual(['Method:R/child.R:SpChild.sp_helper#0:global:0.85']);
  });

  it("a same-named private method of another class is that class's own", () => {
    expect(callsFrom('sp_other_run', 'R/other.R')).toEqual([
      'Method:R/other.R:SpOther.sp_helper#0:global:0.85',
    ]);
  });
});

describe('a call that finds no member adds no edge and records an outcome', () => {
  it.each([
    ['super$ of a member no ancestor has', 'sp_run_super_missing', 'R/child.R', 'sp_nothere', 11],
    [
      'private$ of a member the class has not',
      'sp_run_private_missing',
      'R/child.R',
      'sp_nothere',
      12,
    ],
    ['private$ of a parent private method', 'sp_run_pbase_private', 'R/child.R', 'sp_pbase', 10],
    ['self$ of a private method', 'sp_run_self_helper', 'R/child.R', 'sp_helper', 13],
    ['super$ with an unindexed parent', 'sp_orphan_run', 'R/other.R', 'sp_deep', 14],
    ['super$ in a class with no parent', 'sp_root_run', 'R/other.R', 'sp_deep', 20],
  ])('%s', (_label, source, file, name, line) => {
    expect(callsFrom(source, file)).toEqual([]);
    expect(outcomesAt(file, name).filter((o) => o.startsWith(`${line}:`))).toEqual([
      `${line}:suppressed:member-lookup-ambiguous`,
    ]);
  });
});

describe('a super or private the function binds itself gets no special binding', () => {
  it.each([
    ['a formal super', 'sp_param_super', 'sp_deep', 5],
    ['a formal private', 'sp_param_private', 'sp_helper', 6],
    ['super assigned in the body', 'sp_rebound_super', 'sp_deep', 9],
    ['private assigned a constant', 'sp_rebound_private', 'sp_helper', 13],
    ['a loop variable super', 'sp_loop_super', 'sp_deep', 16],
  ])('%s: no edge, receiver-owned-but-unbound', (_label, source, name, line) => {
    expect(callsFrom(source, 'R/shadow.R')).toEqual([]);
    expect(outcomesAt('R/shadow.R', name).filter((o) => o.startsWith(`${line}:`))).toEqual([
      `${line}:suppressed:receiver-owned-but-unbound`,
    ]);
  });
});

describe('no free-function decoy is reached', () => {
  it('no CALLS edge targets a decoy of base.R', () => {
    expect(
      getRelationships(result, 'CALLS')
        .filter((e) => e.targetLabel === 'Function' && e.targetFilePath === 'R/base.R')
        .map((e) => `${e.source} -> ${e.target}`),
    ).toEqual([]);
  });
});
