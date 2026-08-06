import { ArrayLiteralExpression } from "../parser/ast/expressions/ArrayLiteralExpression";
import { AssignmentExpression } from "../parser/ast/expressions/AssignmentExpression";
import { CallExpression } from "../parser/ast/expressions/CallExpression";
import { CastExpression } from "../parser/ast/expressions/CastExpression";
import { Identifier } from "../parser/ast/expressions/Identifier";
import { IndexExpression } from "../parser/ast/expressions/IndexExpression";
import { InfixExpression } from "../parser/ast/expressions/InfixExpression";
import { MemberExpression } from "../parser/ast/expressions/MemberExpression";
import { PointerMemberExpression } from "../parser/ast/expressions/PointerMemberExpression";
import { StringLiteralExpression } from "../parser/ast/expressions/StringLiteral";
import { StructLiteralExpression } from "../parser/ast/expressions/StructLiteralExpression";
import { BlockStatement } from "../parser/ast/statements/BlockStatement";
import { DeferStatement } from "../parser/ast/statements/DeferStatement";
import { ExpressionStatement } from "../parser/ast/statements/ExpressionStatement";
import { ForStatement } from "../parser/ast/statements/ForStatement";
import { IfStatement } from "../parser/ast/statements/IfStatement";
import { LetStatement } from "../parser/ast/statements/LetStatement";
import { ReturnStatement } from "../parser/ast/statements/ReturnStatement";
import { SwitchStatement } from "../parser/ast/statements/SwitchStatement";
import { TuplePattern } from "../parser/ast/statements/TuplePattern";
import { WhileStatement } from "../parser/ast/statements/WhileStatement";
import type { ASTExpression, ASTStatement } from "../parser/ast/types/ast.type";

export type LiteralExpression =
  | ArrayLiteralExpression
  | StringLiteralExpression
  | StructLiteralExpression;

export type LiteralSite = {
  expr: LiteralExpression;
  kind: "array" | "string" | "struct";
};

export type EscapeViolation = {
  // §33.3's three sites, plus a `free` whose operand is not heap storage.
  site: "return" | "global" | "store" | "free-frame" | "free-static";
  token: ASTExpression["token"];
};

export type EscapeAnalysis = {
  violations: EscapeViolation[];
  /** Sites whose storage reaches a rejection site; T71 keeps these static. */
  escaping: Set<LiteralExpression>;
  /** Every `let`-initializer literal site in the function, escaping or not. */
  sites: LiteralSite[];
};

type BindingId = number;
type Provenance = {
  sites: Set<LiteralExpression>;
  bindings: Set<BindingId>;
  /** Module-scope literal bindings reached — static storage, never freeable. */
  statics: Set<string>;
};

function literalKind(expr: ASTExpression): LiteralSite["kind"] | undefined {
  if (expr instanceof ArrayLiteralExpression) return "array";
  if (expr instanceof StringLiteralExpression) return "string";
  if (expr instanceof StructLiteralExpression) return "struct";
  return undefined;
}

function emptyProvenance(): Provenance {
  return { sites: new Set(), bindings: new Set(), statics: new Set() };
}

// Assignment aliases (O4), so initializer syntax alone is unsound —
// `let q = p; return q;` escapes it. Hence a per-function binding fixpoint.
export function analyzeEscapes(
  body: BlockStatement,
  isGlobalName: (name: string) => boolean,
  carriesReference: (expr: ASTExpression) => boolean,
  isStaticGlobal: (name: string) => boolean = () => false,
  freeOperand: (expr: ASTExpression) => ASTExpression | undefined = () => undefined,
): EscapeAnalysis {
  const sites: LiteralSite[] = [];
  const seeds = new Map<BindingId, Set<LiteralExpression>>();
  const flows: Array<{ target: BindingId; source: Provenance }> = [];
  const checks: Array<{
    site: EscapeViolation["site"];
    token: ASTExpression["token"];
    source: Provenance;
  }> = [];
  const scopes: Array<Map<string, BindingId>> = [];
  let nextBinding: BindingId = 0;

  function declare(name: string): BindingId {
    const id = nextBinding++;
    scopes[scopes.length - 1]?.set(name, id);
    return id;
  }

  function lookup(name: string): BindingId | undefined {
    for (let index = scopes.length - 1; index >= 0; index -= 1) {
      const found = scopes[index]?.get(name);
      if (found !== undefined) return found;
    }
    return undefined;
  }

  function provenance(expr: ASTExpression | null): Provenance {
    if (!expr) return emptyProvenance();
    // A scalar member read (`p.x`) copies a value out of the frame; only an
    // aggregate-typed expression carries the reference itself.
    if (!carriesReference(expr)) return emptyProvenance();
    if (expr instanceof Identifier) {
      const name = expr.tokenLiteral();
      const binding = lookup(name);
      if (binding !== undefined) {
        return { sites: new Set(), bindings: new Set([binding]), statics: new Set() };
      }
      return isStaticGlobal(name)
        ? { sites: new Set(), bindings: new Set(), statics: new Set([name]) }
        : emptyProvenance();
    }
    if (expr instanceof MemberExpression || expr instanceof PointerMemberExpression) {
      return provenance(expr.parent);
    }
    if (expr instanceof IndexExpression) return provenance(expr.left);
    if (expr instanceof CastExpression) return provenance(expr.expr);
    return emptyProvenance();
  }

  // Descends fully: an allocator call can hide under a cast
  // (`realloc(p, 16) as Cell`), and assignments nest too.
  function walkExpression(expr: ASTExpression | null): void {
    if (!expr) return;
    const freed = freeOperand(expr);
    if (freed) checks.push({ site: "free-frame", token: expr.token, source: provenance(freed) });

    if (expr instanceof AssignmentExpression) {
      walkExpression(expr.left);
      walkExpression(expr.value);
      if (expr.value === null) return;
      const source = provenance(expr.value);
      if (expr.left instanceof Identifier) {
        const name = expr.left.tokenLiteral();
        const binding = lookup(name);
        if (binding !== undefined) flows.push({ target: binding, source });
        else if (isGlobalName(name)) checks.push({ site: "global", token: expr.token, source });
        return;
      }
      // A field or element store reaches longer-lived storage whatever its root.
      checks.push({ site: "store", token: expr.token, source });
      return;
    }

    if (expr instanceof CallExpression) {
      for (const argument of expr.args) walkExpression(argument);
      return;
    }
    if (expr instanceof CastExpression) {
      walkExpression(expr.expr);
      return;
    }
    if (expr instanceof InfixExpression) {
      walkExpression(expr.left);
      walkExpression(expr.right);
      return;
    }
    if (expr instanceof IndexExpression) {
      walkExpression(expr.left);
      walkExpression(expr.index);
      return;
    }
    if (expr instanceof MemberExpression || expr instanceof PointerMemberExpression) {
      walkExpression(expr.parent);
    }
  }

  function walkStatement(statement: ASTStatement): void {
    if (statement instanceof LetStatement) {
      const initializer = statement.expression;
      walkExpression(initializer);
      const names =
        statement.pattern instanceof TuplePattern
          ? statement.pattern.names.flatMap((entry) => (entry.kind === "name" ? [entry.value] : []))
          : [statement.identifier.tokenLiteral()];
      const source = provenance(initializer);
      const kind = initializer ? literalKind(initializer) : undefined;
      for (const name of names) {
        const binding = declare(name);
        if (kind !== undefined && initializer) {
          sites.push({ expr: initializer as LiteralExpression, kind });
          seeds.set(binding, new Set([initializer as LiteralExpression]));
        }
        flows.push({ target: binding, source });
      }
      return;
    }
    if (statement instanceof ReturnStatement) {
      for (const value of statement.returnValues) {
        walkExpression(value);
        checks.push({ site: "return", token: value.token, source: provenance(value) });
      }
      return;
    }
    if (statement instanceof ExpressionStatement) {
      walkExpression(statement.expression);
      return;
    }
    // A deferred call frees just as surely as an immediate one.
    if (statement instanceof DeferStatement) {
      walkExpression(statement.call);
      return;
    }
    if (statement instanceof BlockStatement) {
      scopes.push(new Map());
      for (const child of statement.statements) walkStatement(child);
      scopes.pop();
      return;
    }
    if (statement instanceof IfStatement) {
      walkExpression(statement.conditionExpr);
      walkStatement(statement.thenBlock);
      if (statement.elseBlock) walkStatement(statement.elseBlock);
      return;
    }
    if (statement instanceof WhileStatement) {
      walkExpression(statement.condExpr);
      walkStatement(statement.loopBody);
      return;
    }
    if (statement instanceof ForStatement) {
      scopes.push(new Map());
      walkStatement(statement.initBlock);
      walkExpression(statement.conditionExpr.expression);
      walkExpression(statement.updateExpr.expression);
      walkStatement(statement.loopBody);
      scopes.pop();
      return;
    }
    if (statement instanceof SwitchStatement) {
      walkExpression(statement.switchExpr);
      for (const branch of statement.cases) walkStatement(branch.body);
      if (statement.default) walkStatement(statement.default);
    }
  }

  scopes.push(new Map());
  for (const statement of body.statements) walkStatement(statement);
  scopes.pop();

  // `let a = b;` and a later `b = a;` are mutually referential, so iterate.
  const reaches = new Map<BindingId, Set<LiteralExpression>>(seeds);
  const reachesStatic = new Map<BindingId, Set<string>>();
  for (let changed = true; changed; ) {
    changed = false;
    for (const flow of flows) {
      const target = reaches.get(flow.target) ?? new Set<LiteralExpression>();
      const targetStatics = reachesStatic.get(flow.target) ?? new Set<string>();
      const before = target.size + targetStatics.size;
      for (const site of flow.source.sites) target.add(site);
      for (const name of flow.source.statics) targetStatics.add(name);
      for (const binding of flow.source.bindings) {
        for (const site of reaches.get(binding) ?? []) target.add(site);
        for (const name of reachesStatic.get(binding) ?? []) targetStatics.add(name);
      }
      if (target.size + targetStatics.size !== before) {
        reaches.set(flow.target, target);
        reachesStatic.set(flow.target, targetStatics);
        changed = true;
      }
    }
  }

  function resolve(source: Provenance): Set<LiteralExpression> {
    const result = new Set(source.sites);
    for (const binding of source.bindings) {
      for (const site of reaches.get(binding) ?? []) result.add(site);
    }
    return result;
  }

  function resolveStatics(source: Provenance): Set<string> {
    const result = new Set(source.statics);
    for (const binding of source.bindings) {
      for (const name of reachesStatic.get(binding) ?? []) result.add(name);
    }
    return result;
  }

  const violations: EscapeViolation[] = [];
  const escaping = new Set<LiteralExpression>();
  const structSites = new Set(sites.filter((site) => site.kind === "struct").map((s) => s.expr));
  for (const check of checks) {
    const reached = resolve(check.source);
    const reachedStatics = resolveStatics(check.source);
    const hitsFrame = [...reached].some((site) => structSites.has(site));
    if (check.site === "free-frame") {
      if (hitsFrame) violations.push({ site: "free-frame", token: check.token });
      else if (reachedStatics.size > 0 || reached.size > 0) {
        violations.push({ site: "free-static", token: check.token });
      }
      continue;
    }
    for (const site of reached) escaping.add(site);
    if (hitsFrame) violations.push({ site: check.site, token: check.token });
  }

  return { violations, escaping, sites };
}
