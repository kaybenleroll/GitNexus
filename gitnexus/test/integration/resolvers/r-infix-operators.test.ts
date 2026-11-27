/**
 * R: a user-defined infix operator is a free call of its `%op%` name. `a %||% b` links to the
 * definition (written with backticks, by `<-` or `=`), in the same file or another file of the
 * package. The base operators (`%in%`, `%o%`, `%*%`, `%%`, `%/%`) and the magrittr pipe `%>%`
 * lex as the same token but bind nothing, because the repository defines no function of that name.
 *
 * Layout: `R/ops.R` defines `%||%` (by `<-`) and `%+%` (by `=`) and uses each; `R/use.R` uses
 * them from another file, and spells the operators the repository does not define.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import path from 'path';
import { FIXTURES, getRelationships, runPipelineFromRepo } from './helpers.js';
import type { PipelineResult } from './helpers.js';

// Cold worker-pool startups otherwise flake against the 5s default ready budget
// on a loaded runner, failing for reasons unrelated to R parsing or resolution.
beforeAll(() => vi.stubEnv('GITNEXUS_WORKER_READY_TIMEOUT_MS', '60000'));
afterAll(() => vi.unstubAllEnvs());

describe('R user-defined infix operators', () => {
  let result: PipelineResult;

  beforeAll(async () => {
    result = await runPipelineFromRepo(path.join(FIXTURES, 'r-infix-operators'), () => {});
  }, 60000);

  /** `target:targetFile:reason:confidence` of every CALLS edge from `source`. */
  const edges = (source: string): string[] =>
    getRelationships(result, 'CALLS')
      .filter((e) => e.source === source)
      .map((e) => `${e.target}:${e.targetFilePath}:${e.rel.reason}:${e.rel.confidence}`)
      .sort();

  const LOCAL = 'local-call:0.85';
  const GLOBAL = 'global-name-fallback:0.5';

  it('links exactly the operator uses of the fixture, and nothing else', () => {
    const all = getRelationships(result, 'CALLS')
      .map((e) => `${e.source}->${e.target}:${e.rel.reason}:${e.rel.confidence}`)
      .sort();
    expect(all).toEqual(
      [
        `chained->\`%||%\`:${GLOBAL}`,
        `cross_default->\`%||%\`:${GLOBAL}`,
        `cross_glue->\`%+%\`:${GLOBAL}`,
        `local_default->\`%||%\`:${LOCAL}`,
        `local_glue->\`%+%\`:${LOCAL}`,
      ].sort(),
    );
  });

  it('links a use in the defining file, for a `<-` and an `=` definition', () => {
    expect(edges('local_default')).toEqual([`\`%||%\`:R/ops.R:${LOCAL}`]);
    expect(edges('local_glue')).toEqual([`\`%+%\`:R/ops.R:${LOCAL}`]);
  });

  it('links a use in another file of the package', () => {
    expect(edges('cross_default')).toEqual([`\`%||%\`:R/ops.R:${GLOBAL}`]);
    expect(edges('cross_glue')).toEqual([`\`%+%\`:R/ops.R:${GLOBAL}`]);
  });

  it('links a chained expression to its operator once', () => {
    expect(edges('chained')).toEqual([`\`%||%\`:R/ops.R:${GLOBAL}`]);
  });

  it('binds no edge for a base operator or for the magrittr pipe', () => {
    expect(edges('base_ops')).toEqual([]);
    expect(edges('magrittr_pipe')).toEqual([]);
  });
});
