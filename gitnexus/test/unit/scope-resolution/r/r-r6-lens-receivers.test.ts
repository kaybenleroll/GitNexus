/**
 * `super` and `private` inside an R6 method are typed as the method's class, like `self`; a
 * function that binds either name itself owns it untyped. This pins the capture side: the three
 * type bindings of a method, the owner tag, and the assignment read that decides ownership.
 */
import { describe, expect, it } from 'vitest';
import Parser from 'tree-sitter';
import R from '@eagleoutice/tree-sitter-r';
import { rScopeOwnsReceivers } from '../../../../src/core/ingestion/languages/r/captures.js';
import {
  rFunctionAssignsName,
  rFunctionMentionsName,
} from '../../../../src/core/ingestion/languages/r/r6-self.js';
import { extractParsedFile } from '../../../../src/core/ingestion/scope-extractor-bridge.js';
import { rProvider } from '../../../../src/core/ingestion/languages/r.js';

const parser = new Parser();
parser.setLanguage(R as Parameters<Parser['setLanguage']>[0]);

const assigns = (source: string, name: string): boolean => {
  const tree = parser.parse(source, undefined, { bufferSize: 1 << 24 });
  const fn = tree.rootNode.descendantsOfType('function_definition')[0];
  return rFunctionAssignsName(fn as never, name);
};

describe('rFunctionAssignsName', () => {
  it.each([
    ['super <- NULL', 'super', true],
    ['NULL -> super', 'super', true],
    ['private = list()', 'private', true],
    ['{ if (a) super <- b }', 'super', true],
    ['super$x <- 1', 'super', false],
    ['super <<- 1', 'super', false],
    ['private <- 1', 'super', false],
    ['(function() super <- 1)()', 'super', false],
  ])('function() %s binds %s: %s', (body, name, expected) => {
    expect(assigns(`f <- function() ${body}`, name)).toBe(expected);
  });
});

describe('rFunctionMentionsName', () => {
  const mentions = (source: string, name: string): boolean => {
    const tree = parser.parse(source, undefined, { bufferSize: 1 << 24 });
    const fn = tree.rootNode.descendantsOfType('function_definition')[0];
    return rFunctionMentionsName(fn as never, name);
  };

  it.each([
    ['super$m()', 'super', true],
    ['private$m()', 'private', true],
    ['(function() super$m())()', 'super', true],
    ['x <- private', 'private', true],
    ['self$m()', 'super', false],
    ['super$m()', 'private', false],
    ['"super"', 'super', false],
  ])('function() %s mentions %s: %s', (body, name, expected) => {
    expect(mentions(`f <- function() ${body}`, name)).toBe(expected);
  });
});

describe('rScopeOwnsReceivers', () => {
  it('reads the names the capture lists', () => {
    const tag = (text: string) => ({ '@receiver-owner.self': { text } }) as never;
    expect(rScopeOwnsReceivers(tag('self'))).toEqual(new Set(['self']));
    expect(rScopeOwnsReceivers(tag('self,super,private'))).toEqual(
      new Set(['self', 'super', 'private']),
    );
    expect(rScopeOwnsReceivers(tag('private'))).toEqual(new Set(['private']));
    expect(rScopeOwnsReceivers({} as never)).toBeUndefined();
  });
});

describe('an R6 method scope', () => {
  const SOURCE = [
    'Foo <- R6::R6Class("Foo",',
    '  public = list(',
    '    both = function() { super$m(); private$n() },',
    '    shadowed = function(super) super$m(),',
    '    only_super = function() super$m(),',
    '    only_private = function() private$n(),',
    '    plain = function() self$k()',
    '  )',
    ')',
    '',
  ].join('\n');

  const file = extractParsedFile(rProvider, SOURCE, 'R/foo.R');
  if (file === undefined) throw new Error('no ParsedFile');
  const bound = file.scopes
    .filter((s) => s.typeBindings.size > 0)
    .map((s) => [...s.typeBindings.keys()].sort().join(','));

  it('binds only the receivers a method mentions; self is always bound', () => {
    expect(bound).toHaveLength(5);
    expect(bound.sort()).toEqual(
      ['private,self,super', 'private,self', 'self', 'self,super', 'self,super']
        .map((k) => k.split(',').sort().join(','))
        .sort(),
    );
  });

  it('types every bound receiver as the class and a function owns the name it binds', () => {
    for (const scope of file.scopes.filter((s) => s.typeBindings.size > 0)) {
      for (const ref of scope.typeBindings.values()) {
        expect(ref.rawName).toBe('Foo');
        expect(ref.source).toBe('self');
      }
    }
    const owners = file.scopes.filter((s) => s.ownsReceivers !== undefined);
    const owned = owners.map((s) => [...(s.ownsReceivers ?? [])].sort().join(','));
    expect(owned).toContain('super');
  });
});
