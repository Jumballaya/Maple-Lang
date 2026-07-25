import { ArrayLiteralExpression } from "../parser/ast/expressions/ArrayLiteralExpression";
import { AssignmentExpression } from "../parser/ast/expressions/AssignmentExpression";
import { CallExpression } from "../parser/ast/expressions/CallExpression";
import { CastExpression } from "../parser/ast/expressions/CastExpression";
import { FunctionLiteralExpression } from "../parser/ast/expressions/FunctionLiteralExpression";
import { Identifier } from "../parser/ast/expressions/Identifier";
import { IndexExpression } from "../parser/ast/expressions/IndexExpression";
import { InfixExpression } from "../parser/ast/expressions/InfixExpression";
import { MemberExpression } from "../parser/ast/expressions/MemberExpression";
import { PointerMemberExpression } from "../parser/ast/expressions/PointerMemberExpression";
import { PostfixExpression } from "../parser/ast/expressions/PostfixExpression";
import { PrefixExpression } from "../parser/ast/expressions/PrefixExpression";
import { StringLiteralExpression } from "../parser/ast/expressions/StringLiteral";
import { StructLiteralExpression } from "../parser/ast/expressions/StructLiteralExpression";
import { BlockStatement } from "../parser/ast/statements/BlockStatement";
import { ExpressionStatement } from "../parser/ast/statements/ExpressionStatement";
import { ForStatement } from "../parser/ast/statements/ForStatement";
import { FunctionStatement } from "../parser/ast/statements/FunctionStatement";
import { IfStatement } from "../parser/ast/statements/IfStatement";
import { LetStatement } from "../parser/ast/statements/LetStatement";
import { ReturnStatement } from "../parser/ast/statements/ReturnStatement";
import { SwitchStatement } from "../parser/ast/statements/SwitchStatement";
import { TuplePattern } from "../parser/ast/statements/TuplePattern";
import { WhileStatement } from "../parser/ast/statements/WhileStatement";
import type { ASTExpression, ASTStatement } from "../parser/ast/types/ast.type";
import type { StructMember } from "../shared/types";
import { getIntrinsic } from "./intrinsics";
import type {
  DeferredGlobalInit,
  FnSignature,
  FunctionMeta,
  StructData,
  VariableMeta,
} from "./metadata";
import type { ModuleGraph, ModuleRecord } from "./module-graph";
import { analyzeReachability, type ReachableSet } from "./reachability";
import { canonicalFnType, isFnType, parseFnType, valueTypeToWasm } from "./types";

export type DeclarationEdges = {
  calls: string[];
  fnRefs: string[];
  globalReads: string[];
  globalWrites: string[];
  runtimeHelpers: string[];
};

type DeclarationBase = {
  name: string;
  sourceName: string;
  moduleKey: string;
  edges: DeclarationEdges;
  fnTypes: string[];
  hasFnTypedSurface: boolean;
  needsFnrefCreation: boolean;
};

export type MergedFunction = DeclarationBase & {
  kind: "function";
  statement: FunctionStatement;
  meta: FunctionMeta;
  resolvedParams: Array<{ name: string; type: string }>;
  resolvedResults: string[];
};

export type MergedGlobal = DeclarationBase & {
  kind: "global";
  statement: LetStatement;
  meta: VariableMeta;
  resolvedType: string;
};

export type MergedDeclaration = MergedFunction | MergedGlobal;

export type MergedStructMember = StructMember & {
  resolvedType: string;
};

export type MergedStruct = {
  identity: string;
  sourceName: string;
  moduleKey: string | null;
  size: number;
  members: Record<string, MergedStructMember>;
  meta: StructData;
};

export type MergedStartupInitializer = {
  id: string;
  moduleKey: string;
  owner: string;
  initializer: DeferredGlobalInit;
};

export type MergedFnTableEntry = {
  functionName: string;
  trampolineName: string;
  signatureKey: string;
  slot: number;
  isLambda: boolean;
};

export type MergedRuntimeHelper = {
  name: string;
  kind: "array" | "string" | "struct" | "fn-ref";
  calls: string[];
  requirements: string[];
};

export type MergedProgram = {
  entryKey: string;
  moduleOrder: string[];
  modules: Map<string, ModuleRecord>;
  declarations: Map<string, MergedDeclaration>;
  functions: Map<string, MergedFunction>;
  globals: Map<string, MergedGlobal>;
  structs: Map<string, MergedStruct>;
  exports: Map<string, string>;
  imports: Map<string, string>;
  externalImports: Array<{ module: "runtime"; name: "memory" }>;
  startupInitializers: MergedStartupInitializer[];
  fnTable: {
    provisional: true;
    required: boolean;
    hasFnTypedSurface: boolean;
    needsFnrefCreation: boolean;
    entries: MergedFnTableEntry[];
    signatures: Map<string, FnSignature>;
  };
  runtimeHelpers: Map<string, MergedRuntimeHelper>;
  reachable: ReachableSet;
};

type ImportKind = "func" | "global" | "struct";
type Scope = Map<string, string>[];

function pushUnique(values: string[], value: string): void {
  if (!values.includes(value)) values.push(value);
}

function emptyEdges(): DeclarationEdges {
  return {
    calls: [],
    fnRefs: [],
    globalReads: [],
    globalWrites: [],
    runtimeHelpers: [],
  };
}

function mangledName(module: ModuleRecord, sourceName: string): string {
  return `${module.manglePrefix}$$${sourceName}`;
}

function dependencyPostOrder(graph: ModuleGraph): ModuleRecord[] {
  const ordered: ModuleRecord[] = [];
  const visited = new Set<string>();

  function visit(key: string): void {
    if (visited.has(key)) return;
    visited.add(key);
    const module = graph.modules.get(key);
    if (!module) return;
    for (const dependency of module.dependencies) {
      if (dependency.kind === "maple") visit(dependency.key);
    }
    ordered.push(module);
  }

  visit(graph.entryKey);
  return ordered;
}

export function buildMergedProgram(graph: ModuleGraph): MergedProgram {
  const orderedModules = dependencyPostOrder(graph);
  const modules = new Map(orderedModules.map((module) => [module.key, module]));
  const imports = new Map<string, string>();
  const importKinds = new Map<string, Map<string, ImportKind>>();
  const structs = new Map<string, MergedStruct>();

  const sharedString = orderedModules
    .map((module) => module.data.structs.string)
    .find((entry): entry is StructData => entry !== undefined);
  if (sharedString) {
    structs.set("string", {
      identity: "string",
      sourceName: "string",
      moduleKey: null,
      size: sharedString.size,
      members: {},
      meta: sharedString,
    });
  }

  for (const module of orderedModules) {
    for (const struct of Object.values(module.data.structs)) {
      if (struct.name === "string") continue;
      const identity = mangledName(module, struct.name);
      structs.set(identity, {
        identity,
        sourceName: struct.name,
        moduleKey: module.key,
        size: struct.size,
        members: {},
        meta: struct,
      });
    }
  }

  for (const module of orderedModules) {
    const kinds = new Map<string, ImportKind>();
    importKinds.set(module.key, kinds);
    for (const [localName, imported] of Object.entries(module.data.imports)) {
      const dependency = module.dependencies.find((entry) => entry.specifier === imported.module);
      if (!dependency || dependency.kind === "external") continue;
      const exporter = graph.modules.get(dependency.key);
      const exported = exporter?.data.exports[imported.name];
      if (!exporter || !exported) continue;
      const target =
        exported.kind === "struct" && imported.name === "string"
          ? "string"
          : mangledName(exporter, imported.name);
      imports.set(mangledName(module, localName), target);
      kinds.set(localName, exported.kind);
    }
  }

  function resolveType(module: ModuleRecord, type: string): string {
    if (type.startsWith("*")) return `*${resolveType(module, type.slice(1))}`;
    if (type.endsWith("[]")) return `${resolveType(module, type.slice(0, -2))}[]`;
    const fnType = parseFnType(type);
    if (fnType) {
      return canonicalFnType(
        fnType.params.map((entry) => resolveType(module, entry)),
        fnType.results.map((entry) => resolveType(module, entry)),
      );
    }
    if (type === "string") return "string";
    if (module.data.structs[type]) return mangledName(module, type);
    if (importKinds.get(module.key)?.get(type) === "struct") {
      return imports.get(mangledName(module, type)) ?? type;
    }
    return type;
  }

  for (const struct of structs.values()) {
    const module = struct.moduleKey ? modules.get(struct.moduleKey) : undefined;
    struct.members = Object.fromEntries(
      Object.entries(struct.meta.members).map(([name, member]) => [
        name,
        {
          ...member,
          resolvedType: module ? resolveType(module, member.type) : member.type,
        },
      ]),
    );
  }

  const declarations = new Map<string, MergedDeclaration>();
  const functions = new Map<string, MergedFunction>();
  const globals = new Map<string, MergedGlobal>();
  const runtimeHelpers = new Map<string, MergedRuntimeHelper>();

  function ensureHelper(helper: MergedRuntimeHelper): void {
    const existing = runtimeHelpers.get(helper.name);
    if (!existing) {
      runtimeHelpers.set(helper.name, helper);
      return;
    }
    for (const call of helper.calls) pushUnique(existing.calls, call);
    for (const requirement of helper.requirements) pushUnique(existing.requirements, requirement);
  }

  function ensureStructHelper(identity: string): string {
    const helperName = `__struct_eq_${identity}`;
    if (runtimeHelpers.has(helperName)) return helperName;
    const helper: MergedRuntimeHelper = {
      name: helperName,
      kind: "struct",
      calls: [],
      requirements: [],
    };
    runtimeHelpers.set(helperName, helper);
    const struct = structs.get(identity);
    if (!struct) return helperName;
    for (const member of Object.values(struct.members)) {
      if (member.resolvedType === "string") {
        ensureHelper({ name: "__string_eq", kind: "string", calls: [], requirements: [] });
        pushUnique(helper.requirements, "__string_eq");
      } else if (structs.has(member.resolvedType)) {
        pushUnique(helper.requirements, ensureStructHelper(member.resolvedType));
      }
    }
    return helperName;
  }

  function importedTarget(
    module: ModuleRecord,
    name: string,
    kind: ImportKind,
  ): string | undefined {
    if (importKinds.get(module.key)?.get(name) !== kind) return undefined;
    return imports.get(mangledName(module, name));
  }

  function functionTarget(module: ModuleRecord, name: string): string | undefined {
    if (module.data.functions[name]) return mangledName(module, name);
    return importedTarget(module, name, "func");
  }

  function globalTarget(module: ModuleRecord, name: string): string | undefined {
    if (module.data.globals[name]) return mangledName(module, name);
    return importedTarget(module, name, "global");
  }

  function localType(scopes: Scope, name: string): string | undefined {
    for (let index = scopes.length - 1; index >= 0; index--) {
      const type = scopes[index]?.get(name);
      if (type !== undefined) return type;
    }
    return undefined;
  }

  function expressionType(module: ModuleRecord, expression: ASTExpression): string | undefined {
    return expression.resolvedType ? resolveType(module, expression.resolvedType) : undefined;
  }

  function addHelperEdge(owner: MergedDeclaration, helperName: string): void {
    pushUnique(owner.edges.runtimeHelpers, helperName);
  }

  function bindLet(scope: Map<string, string>, statement: LetStatement): void {
    if (statement.pattern instanceof TuplePattern) {
      for (const name of statement.pattern.names) {
        if (name.kind === "name") scope.set(name.value, "unknown");
      }
    } else {
      scope.set(statement.pattern.tokenLiteral(), statement.typeAnnotation);
    }
  }

  function walkDeclaration(module: ModuleRecord, owner: MergedDeclaration): void {
    const scopes: Scope = [new Map()];

    function registerFnType(type: string): void {
      const resolved = resolveType(module, type);
      if (!isFnType(resolved)) return;
      owner.hasFnTypedSurface = true;
      pushUnique(owner.fnTypes, resolved);
    }

    function walkBlock(block: BlockStatement, parentScopes: Scope): void {
      const blockScopes = [...parentScopes, new Map<string, string>()];
      for (const statement of block.statements) walkStatement(statement, blockScopes);
    }

    function recordIdentifier(
      expression: Identifier,
      mode: "read" | "write",
      currentScopes: Scope,
    ): void {
      const declaration = (expression as ASTExpression).resolvedDecl;
      if (declaration?.kind === "local" || declaration?.kind === "param") return;
      const name = declaration?.name ?? expression.tokenLiteral();
      if (!declaration && localType(currentScopes, name) !== undefined) return;
      const global = globalTarget(module, name);
      if (global) {
        pushUnique(mode === "read" ? owner.edges.globalReads : owner.edges.globalWrites, global);
        return;
      }
      if (mode === "read") {
        const fn = functionTarget(module, name);
        if (fn) {
          pushUnique(owner.edges.fnRefs, fn);
          owner.hasFnTypedSurface = true;
          owner.needsFnrefCreation = true;
          addHelperEdge(owner, "__make_fnref");
          const alloc = importedTarget(module, "alloc", "func");
          ensureHelper({
            name: "__make_fnref",
            kind: "fn-ref",
            calls: alloc ? [alloc] : [],
            requirements: [],
          });
        }
      }
    }

    function walkAssignmentTarget(
      expression: ASTExpression,
      compound: boolean,
      currentScopes: Scope,
    ): void {
      if (expression instanceof Identifier) {
        recordIdentifier(expression, "write", currentScopes);
        if (compound) recordIdentifier(expression, "read", currentScopes);
        return;
      }
      if (expression instanceof IndexExpression) {
        ensureHelper({ name: "__elem_addr", kind: "array", calls: [], requirements: [] });
        addHelperEdge(owner, "__elem_addr");
        if (expression.left instanceof Identifier) {
          recordIdentifier(expression.left, "write", currentScopes);
        }
        walkExpression(expression.left, currentScopes);
        walkExpression(expression.index, currentScopes);
        return;
      }
      if (expression instanceof MemberExpression || expression instanceof PointerMemberExpression) {
        if (expression.parent instanceof Identifier) {
          recordIdentifier(expression.parent, "write", currentScopes);
        }
        walkExpression(expression.parent, currentScopes);
        return;
      }
      walkExpression(expression, currentScopes);
    }

    function walkExpression(expression: ASTExpression, currentScopes: Scope): void {
      if (expression instanceof Identifier) {
        recordIdentifier(expression, "read", currentScopes);
        return;
      }
      if (expression instanceof CallExpression) {
        const lexicalType = localType(currentScopes, expression.func);
        if (lexicalType && isFnType(resolveType(module, lexicalType))) {
          registerFnType(lexicalType);
        } else if ((expression as ASTExpression).resolvedCallTarget?.kind === "field") {
          const target = (expression as ASTExpression).resolvedCallTarget;
          if (target?.kind === "field") registerFnType(target.fnType);
        }
        const callDeclaration = (expression as ASTExpression).resolvedDecl;
        if (
          callDeclaration &&
          (callDeclaration.kind === "function" || callDeclaration.kind === "import")
        ) {
          const target = functionTarget(module, callDeclaration.name);
          if (target) pushUnique(owner.edges.calls, target);
        } else if (
          !callDeclaration &&
          localType(currentScopes, expression.func) === undefined &&
          !getIntrinsic(expression.func)
        ) {
          const target = functionTarget(module, expression.func);
          if (target) pushUnique(owner.edges.calls, target);
        }
        for (const argument of expression.args) walkExpression(argument, currentScopes);
        return;
      }
      if (expression instanceof AssignmentExpression) {
        walkAssignmentTarget(expression.left, expression.operator !== "=", currentScopes);
        if (expression.value) walkExpression(expression.value, currentScopes);
        return;
      }
      if (expression instanceof IndexExpression) {
        ensureHelper({ name: "__elem_addr", kind: "array", calls: [], requirements: [] });
        addHelperEdge(owner, "__elem_addr");
        walkExpression(expression.left, currentScopes);
        walkExpression(expression.index, currentScopes);
        return;
      }
      if (expression instanceof InfixExpression) {
        if (expression.operator === "==" || expression.operator === "!=") {
          const leftType = expressionType(module, expression.left);
          const rightType = expressionType(module, expression.right);
          if (leftType && leftType === rightType) {
            if (leftType === "string") {
              ensureHelper({ name: "__string_eq", kind: "string", calls: [], requirements: [] });
              addHelperEdge(owner, "__string_eq");
            } else if (structs.has(leftType)) {
              addHelperEdge(owner, ensureStructHelper(leftType));
            }
          }
        }
        walkExpression(expression.left, currentScopes);
        walkExpression(expression.right, currentScopes);
        return;
      }
      if (expression instanceof PrefixExpression) {
        if (expression.right) walkExpression(expression.right, currentScopes);
        return;
      }
      if (expression instanceof PostfixExpression) {
        if (expression.left) walkAssignmentTarget(expression.left, true, currentScopes);
        return;
      }
      if (expression instanceof CastExpression) {
        walkExpression(expression.expr, currentScopes);
        return;
      }
      if (expression instanceof MemberExpression || expression instanceof PointerMemberExpression) {
        walkExpression(expression.parent, currentScopes);
        return;
      }
      if (expression instanceof StringLiteralExpression) {
        return;
      }
      if (expression instanceof ArrayLiteralExpression) {
        for (const element of expression.elements) walkExpression(element, currentScopes);
        return;
      }
      if (expression instanceof StructLiteralExpression) {
        for (const member of Object.values(expression.members))
          walkExpression(member, currentScopes);
        return;
      }
      if (expression instanceof FunctionLiteralExpression) {
        const functionScopes = [...currentScopes, new Map<string, string>()];
        const scope = functionScopes.at(-1)!;
        for (const parameter of expression.params) {
          scope.set(parameter.identifier.tokenLiteral(), parameter.type);
        }
        walkBlock(expression.body, functionScopes);
      }
    }

    function walkStatement(statement: ASTStatement, currentScopes: Scope): void {
      if (statement instanceof LetStatement) {
        if (statement.expression) walkExpression(statement.expression, currentScopes);
        registerFnType(statement.typeAnnotation);
        bindLet(currentScopes.at(-1)!, statement);
        return;
      }
      if (statement instanceof ReturnStatement) {
        for (const value of statement.returnValues) walkExpression(value, currentScopes);
        return;
      }
      if (statement instanceof ExpressionStatement) {
        if (statement.expression) walkExpression(statement.expression, currentScopes);
        return;
      }
      if (statement instanceof IfStatement) {
        walkExpression(statement.conditionExpr, currentScopes);
        walkBlock(statement.thenBlock, currentScopes);
        if (statement.elseBlock) walkBlock(statement.elseBlock, currentScopes);
        return;
      }
      if (statement instanceof WhileStatement) {
        walkExpression(statement.condExpr, currentScopes);
        walkBlock(statement.loopBody, currentScopes);
        return;
      }
      if (statement instanceof ForStatement) {
        const forScopes = [...currentScopes, new Map<string, string>()];
        if (statement.initBlock.expression) {
          walkExpression(statement.initBlock.expression, forScopes);
        }
        bindLet(forScopes.at(-1)!, statement.initBlock);
        if (statement.conditionExpr.expression) {
          walkExpression(statement.conditionExpr.expression, forScopes);
        }
        if (statement.updateExpr.expression)
          walkExpression(statement.updateExpr.expression, forScopes);
        walkBlock(statement.loopBody, forScopes);
        return;
      }
      if (statement instanceof SwitchStatement) {
        walkExpression(statement.switchExpr, currentScopes);
        for (const branch of statement.cases) walkBlock(branch.body, currentScopes);
        if (statement.default) walkBlock(statement.default, currentScopes);
        return;
      }
      if (statement instanceof BlockStatement) walkBlock(statement, currentScopes);
    }

    if (owner.kind === "function") {
      for (const parameter of owner.statement.fnExpr.params) {
        scopes[0]!.set(parameter.identifier.tokenLiteral(), parameter.type);
        registerFnType(parameter.type);
      }
      for (const result of owner.statement.fnExpr.returnTypes) registerFnType(result);
      walkBlock(owner.statement.fnExpr.body, scopes);
    } else if (owner.statement.expression) {
      walkExpression(owner.statement.expression, scopes);
    }
  }

  for (const module of orderedModules) {
    for (const statement of module.ast.statements) {
      if (statement instanceof FunctionStatement) {
        const meta = module.data.functions[statement.name];
        if (!meta) continue;
        const name = mangledName(module, statement.name);
        const declaration: MergedFunction = {
          kind: "function",
          name,
          sourceName: statement.name,
          moduleKey: module.key,
          statement,
          meta,
          resolvedParams: meta.params.map((parameter) => ({
            name: parameter.name,
            type: resolveType(module, parameter.type),
          })),
          resolvedResults: meta.mapleResults.map((result) => resolveType(module, result)),
          edges: emptyEdges(),
          fnTypes: [],
          hasFnTypedSurface: false,
          needsFnrefCreation: false,
        };
        declarations.set(name, declaration);
        functions.set(name, declaration);
        walkDeclaration(module, declaration);
      } else if (
        statement instanceof LetStatement &&
        !(statement.pattern instanceof TuplePattern)
      ) {
        const sourceName = statement.pattern.tokenLiteral();
        const meta = module.data.globals[sourceName];
        if (!meta) continue;
        const name = mangledName(module, sourceName);
        const declaration: MergedGlobal = {
          kind: "global",
          name,
          sourceName,
          moduleKey: module.key,
          statement,
          meta,
          resolvedType: resolveType(module, meta.type),
          edges: emptyEdges(),
          fnTypes: [],
          hasFnTypedSurface: false,
          needsFnrefCreation: false,
        };
        declarations.set(name, declaration);
        globals.set(name, declaration);
        walkDeclaration(module, declaration);
      }
    }
  }

  const exports = new Map<string, string>();
  const entryModule = graph.modules.get(graph.entryKey);
  if (entryModule) {
    for (const [name, exported] of Object.entries(entryModule.data.exports)) {
      exports.set(
        name,
        exported.kind === "struct" && name === "string" ? "string" : mangledName(entryModule, name),
      );
    }
  }

  const startupInitializers: MergedStartupInitializer[] = [];
  const memoryModule = orderedModules.find(
    (module) => module.bundledStdlib === "memory" && module.data.exports.heap_init?.kind === "func",
  );
  const heapInitializer: MergedStartupInitializer | undefined = memoryModule
    ? (() => {
        const id = `${memoryModule.manglePrefix}$$heap-init`;
        const owner = mangledName(memoryModule, "heap_init");
        return {
          id,
          moduleKey: memoryModule.key,
          owner,
          initializer: {
            kind: "call",
            id,
            owner,
            name: owner,
            args: [{ type: "i32", value: 0 }],
          },
        };
      })()
    : undefined;
  for (const module of orderedModules) {
    for (let index = 0; index < module.data.deferredGlobalInits.length; index++) {
      const initializer = module.data.deferredGlobalInits[index]!;
      const id = `${module.manglePrefix}$$init$${index}`;
      const owner = mangledName(module, initializer.owner);
      const mergedPayload: DeferredGlobalInit =
        initializer.kind === "memory"
          ? { kind: "memory", id, owner }
          : initializer.kind === "global" || initializer.kind === "array-elements"
            ? {
                ...initializer,
                id,
                owner,
                name: mangledName(module, initializer.name),
              }
            : {
                ...initializer,
                id,
                owner,
                name:
                  functionTarget(module, initializer.name) ?? mangledName(module, initializer.name),
              };
      const startup: MergedStartupInitializer = {
        id,
        moduleKey: module.key,
        owner,
        initializer: mergedPayload,
      };
      startupInitializers.push(startup);
    }
  }

  const fnEntries: MergedFnTableEntry[] = [];
  const fnSignatures = new Map<string, FnSignature>();
  const slotted = new Set<string>();
  for (const module of orderedModules) {
    for (const [key, signature] of module.data.fnSignatures) {
      if (!fnSignatures.has(key)) fnSignatures.set(key, signature);
    }
    const entries = [...module.data.fnTable.values()].sort((left, right) => left.slot - right.slot);
    for (const entry of entries) {
      const functionName = mangledName(module, entry.originalName);
      if (slotted.has(functionName)) continue;
      slotted.add(functionName);
      fnEntries.push({
        functionName,
        trampolineName: mangledName(module, entry.trampolineName),
        signatureKey: entry.signatureKey,
        slot: fnEntries.length,
        isLambda: entry.isLambda,
      });
    }
  }

  const reachabilityInput = {
    declarations,
    exports,
    startupInitializers,
    fnTableEntries: fnEntries,
    runtimeHelpers,
  };
  let reachability = analyzeReachability(reachabilityInput);
  const allocatorName = memoryModule ? mangledName(memoryModule, "malloc") : undefined;
  if (heapInitializer && allocatorName && reachability.reachable.functions.has(allocatorName)) {
    startupInitializers.unshift(heapInitializer);
    reachability = analyzeReachability(reachabilityInput);
  }

  const reachableSignatures = new Map<string, FnSignature>();
  for (const declaration of declarations.values()) {
    const reached =
      declaration.kind === "function"
        ? reachability.reachable.functions.has(declaration.name)
        : reachability.reachable.globals.has(declaration.name);
    if (!reached) continue;
    for (const key of declaration.fnTypes) {
      const parsed = parseFnType(key);
      if (!parsed || reachableSignatures.has(key)) continue;
      const results = parsed.results.filter((result) => result !== "void").map(valueTypeToWasm);
      reachableSignatures.set(key, {
        key,
        params: parsed.params.map(valueTypeToWasm),
        results,
        isVoid: results.length === 0,
      });
    }
  }
  for (const entry of reachability.fnTableEntries) {
    const signature = fnSignatures.get(entry.signatureKey);
    if (signature) reachableSignatures.set(entry.signatureKey, signature);
  }

  return {
    entryKey: graph.entryKey,
    moduleOrder: orderedModules.map((module) => module.key),
    modules,
    declarations,
    functions,
    globals,
    structs,
    exports,
    imports,
    externalImports: [{ module: "runtime", name: "memory" }],
    startupInitializers,
    fnTable: {
      provisional: true,
      required: reachability.fnTableEntries.length > 0,
      hasFnTypedSurface: reachability.hasFnTypedSurface,
      needsFnrefCreation: reachability.needsFnrefCreation,
      entries: reachability.fnTableEntries,
      signatures: reachableSignatures,
    },
    runtimeHelpers,
    reachable: reachability.reachable,
  };
}
