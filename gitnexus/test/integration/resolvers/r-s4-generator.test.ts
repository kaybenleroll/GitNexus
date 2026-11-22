/**
 * R: calls of an S4 generator (`Circle <- setClass("Circle", ...)`) and of a plain function of the
 * same name. Characterisation cells: they pin today's behaviour, and no generator-specific rule
 * exists. A call of the name is resolved as any free call.
 *
 * - (limit, R-18) `library(geo); Circle(r = 1)` in a script binds a same-named plain function of
 *   another script at 0.5, although R calls geo's generator: the guess crosses load units. The
 *   same holds for the S4 generic `area(c)` against a plain `area` of a script.
 * - Bioconductor idiom (bare `setClass("Circle", ...)` plus `Circle <- function(r) new(...)`):
 *   the call reaches the constructor function, which is right.
 * - Collate order: in one package, `R/a.R` assigns the generator and `R/b.R` a plain function of
 *   the same name. `b.R` is loaded later and wins, so the 0.5 edge to `b.R` is right. This is why
 *   no rule vetoes a plain function that shares its name with a generator.
 *
 * - The ingestion integrity check reports `collapsedIdentity` for every CALLS edge here. That is
 *   not a node collision: a free call is emitted once per caller and target pair, so its edge id
 *   carries no source span and the check cannot verify one. The generator and the constructor
 *   function stay two nodes (a `Class` and a `Function`).
 *
 * Fixtures under `r-s4-generator/`, one repository each.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import path from 'path';
import {
  FIXTURES,
  getNodesByLabel,
  getRelationships,
  runPipelineFromRepo,
  type PipelineResult,
} from './helpers.js';

beforeAll(() => vi.stubEnv('GITNEXUS_WORKER_READY_TIMEOUT_MS', '60000'));
afterAll(() => vi.unstubAllEnvs());

const GUESS = 'global-name-fallback:0.5';

/** Every CALLS edge of each repository, by source node id: `targetId:reason:confidence`. */
const CASES: Readonly<Record<string, Readonly<Record<string, readonly string[]>>>> = {
  generator: {
    // (limit, R-18) the generic `area` and the generator `Circle` of geo are not reached.
    'Function:scripts/use.R:g1': [`Function:scripts/legacy.R:area:${GUESS}`],
    'Function:scripts/use.R:g2': [`Function:scripts/legacy2.R:Circle:${GUESS}`],
    'Function:scripts/nolib.R:g3': [`Function:scripts/legacy.R:area:${GUESS}`],
  },
  'control-scripts': {
    'Function:scripts/c.R:k': [`Function:scripts/b.R:Circle:${GUESS}`],
  },
  'control-package': {
    'Function:scripts/use.R:k': ['Function:geo/R/b.R:Circle:import-resolved:0.85'],
  },
  // One file holds both the class and the constructor function, the function first: only the
  // function is a callee and finalize binds the first def it meets, so the import edge is kept (a
  // class def sharing the qualified name must not count as a repeat).
  'same-file-library': {
    'Function:scripts/use.R:k': ['Function:geo/R/a.R:Circle:import-resolved:0.85'],
  },
  'same-file-importfrom': {
    'Function:app/R/use.R:k': ['Function:geo/R/a.R:Circle:import-resolved:0.85'],
  },
  // (limit) With `setClass()` first, finalize binds the class def, so the import is refused and the
  // call reaches the right function through the 0.5 guess.
  'same-file-classfirst-library': {
    'Function:scripts/use.R:k': [`Function:geo/R/a.R:Circle:${GUESS}`],
  },
  'same-file-classfirst-importfrom': {
    'Function:app/R/use.R:k': [`Function:geo/R/a.R:Circle:${GUESS}`],
  },
  'collate-order': {
    // Correct: b.R collates after a.R, so its Circle is the binding R calls.
    'Function:geo/R/c.R:k': [`Function:geo/R/b.R:Circle:${GUESS}`],
  },
};

describe.each(Object.entries(CASES))('R S4 generator calls: %s', (fixture, expected) => {
  let result: PipelineResult;
  beforeAll(async () => {
    result = await runPipelineFromRepo(path.join(FIXTURES, 'r-s4-generator', fixture), () => {});
  }, 120000);

  it('has exactly the pinned CALLS edges', () => {
    const actual: Record<string, string[]> = {};
    for (const e of getRelationships(result, 'CALLS')) {
      (actual[e.rel.sourceId] ??= []).push(`${e.rel.targetId}:${e.rel.reason}:${e.rel.confidence}`);
    }
    for (const targets of Object.values(actual)) targets.sort();
    expect(actual).toEqual(expected);
  });
});

describe.each(Object.entries(CASES))(
  'R S4 generator integrity receipt: %s',
  (fixture, expected) => {
    let result: PipelineResult;
    beforeAll(async () => {
      result = await runPipelineFromRepo(path.join(FIXTURES, 'r-s4-generator', fixture), () => {});
    }, 120000);

    it('counts each CALLS edge as one span-less free-call edge, not a node collision', () => {
      const calls = getRelationships(result, 'CALLS');
      const expectedCount = Object.values(expected).reduce((n, targets) => n + targets.length, 0);
      expect(calls).toHaveLength(expectedCount);
      for (const e of calls) {
        expect(e.rel.id).toBe(`rel:CALLS:${e.rel.sourceId}->${e.rel.targetId}`);
      }
      // Aggregated caller/target identity is the only unverified reason: no edge is point-only.
      expect(result.relationshipIntegrity).toMatchObject({
        checkedSites: 0,
        unverifiedEdges: expectedCount,
      });
    });
  },
);

describe('R S4 generator and same-named constructor keep separate nodes', () => {
  it.each(['same-file-library', 'same-file-classfirst-library'])(
    '%s: one Class and one Function named Circle',
    async (fixture) => {
      const result = await runPipelineFromRepo(
        path.join(FIXTURES, 'r-s4-generator', fixture),
        () => {},
      );
      const classes = getNodesByLabel(result, 'Class').filter((n) => n.endsWith('Circle'));
      const functions = getNodesByLabel(result, 'Function').filter((n) => n.endsWith('Circle'));
      expect(classes).toHaveLength(1);
      expect(functions).toHaveLength(1);
    },
    120000,
  );
});
