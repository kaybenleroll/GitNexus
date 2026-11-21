import type { Capture, CaptureMatch, MixedChainStep } from 'gitnexus-shared';
import { nodeToCapture, syntheticCapture } from '../../utils/ast-helpers.js';
import type { SyntaxNode } from '../../utils/ast-helpers.js';
import { getRParser, getRScopeQuery } from './query.js';
import { isRNonNamingScopeMatch } from './naming-argument.js';
import { MAX_CHAIN_DEPTH } from '../../utils/call-analysis.js';
import { encodeReceiverChain } from '../../utils/receiver-chain-codec.js';
import { getTreeSitterBufferSize } from '../../constants.js';
import { parseSourceSafe } from '../../../tree-sitter/safe-parse.js';
import {
  assignmentTarget,
  collectRFrameNames,
  rReplacementCallTest,
  rSetterName,
} from './assignment.js';
import { rConstructorAnchorTest } from './receiver-agreement.js';
import {
  createSelfOwnerClassifier,
  fileBindsSelf,
  rDefinitionPositionKey,
  recordRR6PrivateMembers,
  R6_BOUND_RECEIVERS,
  rFunctionAssignsName,
  rFunctionMentionsName,
  rR6Method,
} from './r6-self.js';

/**
 * Run the R scope query and attach lexical names, receiver ownership and constructor evidence.
 * Use the block spans from the query to keep assignments in their owning frame.
 */
export function emitRScopeCaptures(
  sourceText: string,
  filePath: string,
  cachedTree?: unknown,
): readonly CaptureMatch[] {
  let tree = cachedTree as ReturnType<ReturnType<typeof getRParser>['parse']> | undefined;
  if (tree === undefined) {
    tree = parseSourceSafe(getRParser(), sourceText, undefined, {
      bufferSize: getTreeSitterBufferSize(sourceText),
    });
  }

  const rawMatches = getRScopeQuery().matches(tree.rootNode);
  const blockScopes = new Set<number>();
  for (const match of rawMatches) {
    for (const capture of match.captures) {
      if (capture.name === 'scope.block') blockScopes.add(capture.node.id);
    }
  }
  const out: CaptureMatch[] = [];
  // A file that binds `self` itself (`self <- Foo$new()` at top level) has a variable of that name
  // for its free functions to read, so they do not own `self`.
  const bindsSelf = fileBindsSelf(tree.rootNode);
  const functionOwnsSelf = createSelfOwnerClassifier();
  const typedMethods = new Set<number>();
  // Where the R6 private members are, for `rResolveSelfMember` (`self$m()` never reaches one).
  const privateMembers = new Set<string>();
  // One linear pass over the tree on the first free call, not a walk up from every call.
  const isReplacementCall = rReplacementCallTest(tree.rootNode);
  // A constructor binding types its name only when every binding of the name in its frame agrees
  // (`receiver-agreement.ts`); the tree is read once, on the first constructor binding.
  const isAgreedConstructor = rConstructorAnchorTest(tree.rootNode);

  for (const m of rawMatches) {
    // The scope query captures every candidate argument of setClass/library/require/
    // source; keep only the one that names the class or import.
    if (isRNonNamingScopeMatch(m.captures)) continue;
    const grouped: Record<string, Capture> = {};
    let hasRealCapture = false;
    let functionNode: SyntaxNode | undefined;
    let methodNode: SyntaxNode | undefined;
    let freeCallNode: SyntaxNode | undefined;
    let chainedReceiver: SyntaxNode | undefined;
    let constructorAnchor: SyntaxNode | undefined;
    for (const c of m.captures) {
      const tag = '@' + c.name;
      if (tag.startsWith('@_')) continue;
      grouped[tag] = nodeToCapture(tag, c.node);
      hasRealCapture = true;
      if (tag === '@scope.function' && c.node.type === 'function_definition') functionNode = c.node;
      if (tag === '@scope.function' && c.node.type === 'argument') methodNode = c.node;
      if (tag === '@reference.call.free') freeCallNode = c.node;
      if (tag === '@reference.receiver' && c.node.type !== 'identifier') chainedReceiver = c.node;
      if (tag === '@type-binding.constructor') constructorAnchor = c.node;
      if (tag === '@scope.module' || tag === '@scope.block') {
        const names = collectRFrameNames(c.node, blockScopes);
        if (names.size > 0)
          grouped['@scope.lexical-names'] = syntheticCapture(
            '@scope.lexical-names',
            c.node,
            JSON.stringify([...names]),
          );
      }
      if (tag === '@scope.module' && c.node.type === 'program' && !bindsSelf) {
        grouped['@receiver-owner.self'] = syntheticCapture('@receiver-owner.self', c.node, 'self');
      }
    }
    if (!hasRealCapture) continue;
    // Dropping the type leaves the receiver untyped, and an untyped receiver gets no edge: the
    // call is unresolved, never bound to another class's method.
    if (constructorAnchor !== undefined && !isAgreedConstructor(constructorAnchor)) continue;
    // `x %op% y <- v` calls `%op%<-`, not `%op%`: no site, as a setter is not minted for it either.
    if (freeCallNode?.type === 'binary_operator' && isAssignmentTarget(freeCallNode)) continue;
    if (freeCallNode?.type === 'binary_operator') {
      recordAsInfixCall(grouped, freeCallNode);
    } else if (freeCallNode !== undefined && isReplacementCall(freeCallNode)) {
      recordAsSetterCall(grouped, freeCallNode);
    }
    // A member call whose receiver is itself a `$` access or a call (`a$b$m()`): mint the
    // truncated chain, or drop the match when the chain has no variable base.
    if (chainedReceiver !== undefined) {
      const chain = rReceiverChain(chainedReceiver);
      if (chain === undefined) continue;
      grouped['@reference.receiver-chain'] = syntheticCapture(
        '@reference.receiver-chain',
        chainedReceiver,
        chain,
      );
    }
    // The function's own scope names what its formals and loop variables bind, so that a call
    // through one of them stops the lexical walk there instead of reaching a top-level function
    // of the same name.
    if (functionNode !== undefined) {
      const names = rFunctionLexicalNames(functionNode, blockScopes);
      if (names.length > 0) {
        grouped['@scope.lexical-names'] = syntheticCapture(
          '@scope.lexical-names',
          functionNode,
          JSON.stringify(names),
        );
      }
      // A function that binds `self` itself (`self <- other()`, a formal or loop variable called
      // `self`) owns it, R6 method or not: the method's typed `self` is no longer the receiver
      // there, so `self$m()` is unresolved unless that binding is typed (`self <- Foo$new()`).
      // `super` and `private` are the same: a function that binds either owns it untyped.
      const owned: string[] = [];
      if (names.includes('self') || (!bindsSelf && functionOwnsSelf(functionNode))) {
        owned.push('self');
      }
      for (const name of R6_BOUND_RECEIVERS) {
        if (name !== 'self' && (names.includes(name) || rFunctionAssignsName(functionNode, name)))
          owned.push(name);
      }
      if (owned.length > 0) {
        grouped['@receiver-owner.self'] = syntheticCapture(
          '@receiver-owner.self',
          functionNode,
          owned.join(','),
        );
      }
    }
    out.push(grouped);
    // An R6 method types `self`, `super` and `private` as its class. The binding is anchored on the method's name, so it
    // lands in the method's own scope (an anchor that spans the whole scope would hoist it to the
    // class scope, which every method of the class shares).
    if (methodNode !== undefined && !typedMethods.has(methodNode.id)) {
      typedMethods.add(methodNode.id);
      const method = rR6Method(methodNode);
      const methodName = methodNode.childForFieldName('name');
      if (method !== null && methodName !== null) {
        // `super` and `private` are the same instance read through another lens (the parents'
        // members, the class's own private members): `rResolveSelfMember` tells them apart by the
        // receiver's name.
        // Only a method that mentions `super` or `private` gets that binding; `self` is always bound.
        const methodFunction = methodNode.childForFieldName('value');
        for (const receiver of R6_BOUND_RECEIVERS) {
          if (
            receiver !== 'self' &&
            (methodFunction === null || !rFunctionMentionsName(methodFunction, receiver))
          )
            continue;
          out.push({
            '@type-binding.self': syntheticCapture('@type-binding.self', methodName, receiver),
            '@type-binding.name': syntheticCapture('@type-binding.name', methodName, receiver),
            '@type-binding.type': syntheticCapture(
              '@type-binding.type',
              methodName,
              method.className,
            ),
          });
        }
        // The method's definition is anchored on this same `argument` node.
        if (method.section === 'private') privateMembers.add(rDefinitionPositionKey(methodNode));
      }
    }
  }

  recordRR6PrivateMembers(filePath, privateMembers);
  return out;
}

/**
 * The receiver chain of a chained member call (`a$b$m()`, `Cls$new()$m()`), encoded with the
 * shared codec's `truncated` marker, or `undefined` when the receiver has no variable base.
 *
 * The walk goes down `extract_operator` (`x$f`, `x@f`: a field step) and `call(function:
 * extract_operator)` (`x$f()`: a call step) to an identifier, which is the base. R6 fields and
 * method results carry no declared type, so a chain is never typed; the marker makes the shared
 * fold refuse it, and the site ends as an unresolved receiver (an outcome, no edge) instead of
 * falling to a free function or a method of the same name elsewhere.
 *
 * `undefined` (the caller drops the match, so the call is invisible: no edge, no outcome) when
 * the base is not a variable (a call of a function or of `pkg::f`, `x[[1]]`, `x[1]`, `(x)`), a
 * step is not an identifier (`a$"b"$m()`), or the codec cannot
 * encode the chain (more steps than it allows, a name with a space). No honest outcome exists
 * for a receiver that is not a variable, and the walk is bounded so a pathological chain costs
 * a constant amount of work.
 */
export function rReceiverChain(receiverNode: SyntaxNode): string | undefined {
  const outerToInner: MixedChainStep[] = [];
  let node: SyntaxNode = receiverNode;
  while (outerToInner.length <= MAX_CHAIN_DEPTH) {
    if (node.type === 'identifier') {
      const steps = outerToInner.reverse();
      return encodeReceiverChain(node.text, steps, { truncated: true });
    }
    const isCall = node.type === 'call';
    const access = isCall ? node.childForFieldName('function') : node;
    if (access?.type !== 'extract_operator') return undefined;
    const lhs = access.childForFieldName('lhs');
    const rhs = access.childForFieldName('rhs');
    if (lhs === null || rhs?.type !== 'identifier') return undefined;
    outerToInner.push({ kind: isCall ? 'call' : 'field', name: rhs.text });
    node = lhs;
  }
  return undefined;
}

/** Whether `node` is the target of an assignment: the left of `<-`, `=`, `<<-`, the right of `->`, `->>`. */
function isAssignmentTarget(node: SyntaxNode): boolean {
  const parent = node.parent;
  return parent !== null && assignmentTarget(parent)?.id === node.id;
}

/**
 * Names the call that an infix expression `a %op% b` makes: the operator token spelled as the
 * definition spells it, in backticks (`` `%op%` ``). R can only define such a function through a
 * backticked or quoted name, and the graph keeps the definition's name as written (see
 * `bare-name.ts`), so the site matches the backticked binding. Only the name keeps the operator's
 * range: the `@reference.call.free` anchor is the whole expression, so it starts at the left-hand
 * side (`foo(x) %||% 1` anchors at `foo`, and `foo(x)` is also a call site of its own). An
 * expression that is itself the target of an assignment (`a %op% b <- v`) never reaches here: R
 * calls `` `%op%<-` `` there, so the caller mints no site for it.
 *
 * An operator token is `%...%` and cannot begin with a backtick, so no `rBareName` is needed.
 */
function recordAsInfixCall(grouped: Record<string, Capture>, expression: SyntaxNode): void {
  const operator = expression.childForFieldName('operator');
  if (operator === null) return;
  grouped['@reference.name'] = syntheticCapture(
    '@reference.name',
    operator,
    '`' + operator.text + '`',
  );
}

/**
 * Rewrites the captures of a call in a replacement position (`foo(x) <- v`) so that the site names
 * the setter: `@reference.name` becomes `` `foo<-` `` and a qualified `pkg::foo` becomes
 * ``pkg::`foo<-` ``. The identifier node keeps its range, so the site stays at one anchor: the getter
 * half of a nested form (`foo(bar(x)) <- 1` also reads `bar(x)`) is not recorded as a second site.
 * Explicit `` `foo<-`(x, 1) `` is a plain call of that name and never reaches here.
 */
function recordAsSetterCall(grouped: Record<string, Capture>, call: SyntaxNode): void {
  const callee = call.childForFieldName('function');
  if (callee === null) return;
  if (callee.type === 'identifier') {
    grouped['@reference.name'] = syntheticCapture(
      '@reference.name',
      callee,
      rSetterName(callee.text),
    );
    return;
  }
  const name = callee.type === 'namespace_operator' ? callee.childForFieldName('rhs') : null;
  if (name?.type !== 'identifier') return;
  grouped['@reference.name'] = syntheticCapture('@reference.name', name, rSetterName(name.text));
  grouped['@reference.qualified-name'] = syntheticCapture(
    '@reference.qualified-name',
    callee,
    callee.text.slice(0, name.startIndex - callee.startIndex) + rSetterName(name.text),
  );
}

/**
 * The names a `function_definition` binds in its own frame without a definition node: all its
 * named formals (`...` is not a name; a default proves nothing about the argument, which may be a
 * function, so a formal with a constant default is a lexical name too), the variable of every
 * `for` loop in its body and every name an ordinary assignment binds to a value that may be a
 * function (`rLexicalAssignedNames`: `helper <- identity`, not `helper <- function(y) 1` nor
 * `helper <- 2`, and not `<<-`), outside any function nested in it (that one binds its own). The
 * assignment names are flow-insensitive: a call before the assignment, or under an `if` that may
 * skip it, stops at the local too and is left unresolved rather than bound to the outer function.
 * A name is
 * kept as written, backticks included, which is how a call site spells it. Read from the tree once
 * per function, so the work over a file is linear in its size; the walk is iterative because a
 * body can nest deeply.
 */
export function rFunctionLexicalNames(fn: SyntaxNode, blockScopes?: ReadonlySet<number>): string[] {
  const names = new Set<string>();
  const parameters = fn.childForFieldName('parameters');
  if (parameters !== null) {
    for (let i = 0; i < parameters.namedChildCount; i++) {
      const parameter = parameters.namedChild(i);
      if (parameter?.type !== 'parameter') continue;
      const name = parameter.childForFieldName('name');
      if (name?.type !== 'identifier' || name.text.length === 0) continue;
      names.add(name.text);
    }
  }
  for (const name of collectRFrameNames(fn, blockScopes)) names.add(name);
  return [...names];
}

/**
 * `LanguageProvider.scopeOwnsReceivers` for R: the module scope, each function frame that is
 * not an R6 method (and not nested in a function), and any function that binds `self` itself
 * (`self <- other()`, a formal called `self`) bind `self` with no type of their own (a function
 * that binds `super` or `private` owns that name the same way), which makes
 * a `self$m()` call there a definitive negative unless that binding is typed. The tag is written by
 * `emitRScopeCaptures`, where the tree is at hand.
 */
const R_SELF_OWNER: ReadonlySet<string> = Object.freeze(new Set(['self']));

export function rScopeOwnsReceivers(match: CaptureMatch): ReadonlySet<string> | undefined {
  const tag = match['@receiver-owner.self'];
  if (tag === undefined) return undefined;
  return tag.text === 'self' ? R_SELF_OWNER : new Set(tag.text.split(','));
}
