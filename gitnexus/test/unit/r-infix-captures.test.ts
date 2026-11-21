/**
 * R: `a %op% b` is a free call of the function named `%op%`. emitRScopeCaptures names the site
 * with the backticks a definition keeps (`` `%op%` ``), anchored on the whole expression, and
 * leaves every other operator alone.
 */
import { describe, expect, it } from 'vitest';
import { emitRScopeCaptures } from '../../src/core/ingestion/languages/r/captures.js';

/** The `@reference.name` of every free-call site in `source`, with the text of its anchor. */
function freeCalls(source: string): string[] {
  return emitRScopeCaptures(source, 'R/a.R')
    .filter((m) => m['@reference.call.free'] !== undefined)
    .map((m) => `${m['@reference.name']?.text} @ ${m['@reference.call.free']?.text}`);
}

describe('R infix operator call sites', () => {
  it('names the site with the backticked operator', () => {
    expect(freeCalls('v %||% 1')).toEqual(['`%||%` @ v %||% 1']);
  });

  it('mints a site for every %...% operator, base operators and the pipe included', () => {
    const names = freeCalls('a %in% b; a %o% b; a %*% b; a %% b; a %/% b; a %>% b').map(
      (s) => s.split(' @ ')[0],
    );
    expect(names).toEqual(['`%in%`', '`%o%`', '`%*%`', '`%%`', '`%/%`', '`%>%`']);
  });

  it('mints one site per operator of a chain', () => {
    expect(freeCalls('a %||% b %||% 1')).toHaveLength(2);
  });

  it('does not treat other operators as calls', () => {
    expect(freeCalls('a + b; a |> f; a <- b; a == b')).toEqual([]);
  });

  it('keeps an ordinary call, and the operator inside its argument', () => {
    expect(freeCalls('f(a %+% b)')).toEqual(['f @ f(a %+% b)', '`%+%` @ a %+% b']);
  });

  it('mints no site for an infix expression that is an assignment target (R calls `%in%<-`)', () => {
    expect(freeCalls('x %in% y <- 1')).toEqual([]);
    expect(freeCalls('x %in% y = 1')).toEqual([]);
    expect(freeCalls('1 -> x %in% y')).toEqual([]);
  });

  it('keeps the site of an operator that is read next to an assignment', () => {
    expect(freeCalls('z <- x %in% y')).toEqual(['`%in%` @ x %in% y']);
    expect(freeCalls('x <- 1 %in% y')).toEqual(['`%in%` @ 1 %in% y']);
  });

  it('keeps a call or member call on the left-hand side as a site of its own', () => {
    // The anchor is the whole expression (it starts at the left-hand side); only the name is the
    // operator. Neither site hides the other.
    expect(freeCalls('foo(x) %||% 1')).toEqual(['foo @ foo(x)', '`%||%` @ foo(x) %||% 1']);
    const member = emitRScopeCaptures('obj$m() %||% y', 'R/a.R');
    const memberSites = member.filter((m) => m['@reference.call.member'] !== undefined);
    expect(memberSites.map((m) => m['@reference.name']?.text)).toEqual(['m']);
    expect(
      member
        .filter((m) => m['@reference.call.free'] !== undefined)
        .map((m) => m['@reference.name']?.text),
    ).toEqual(['`%||%`']);
  });

  it('names the site with the token as written, a name that is never backticked in the source', () => {
    expect(freeCalls('a %.% b; a %+.% b')).toEqual(['`%.%` @ a %.% b', '`%+.%` @ a %+.% b']);
  });

  it('stays cheap on a long left-nested chain (2000 operators)', () => {
    const source = 'a' + ' %+% b'.repeat(2000);
    const start = performance.now();
    expect(freeCalls(source)).toHaveLength(2000);
    // Measured at about 75 ms here; the text kept per site is quadratic in the chain but small.
    expect(performance.now() - start).toBeLessThan(5000);
  });
});
