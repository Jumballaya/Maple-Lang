import { ArrayLiteralExpression } from "../../parser/ast/expressions/ArrayLiteralExpression";
import { AssignmentExpression } from "../../parser/ast/expressions/AssignmentExpression";
import { CallExpression } from "../../parser/ast/expressions/CallExpression";
import { CastExpression } from "../../parser/ast/expressions/CastExpression";
import { FunctionLiteralExpression } from "../../parser/ast/expressions/FunctionLiteralExpression";
import { Identifier } from "../../parser/ast/expressions/Identifier";
import { IndexExpression } from "../../parser/ast/expressions/IndexExpression";
import { InfixExpression } from "../../parser/ast/expressions/InfixExpression";
import { MemberExpression } from "../../parser/ast/expressions/MemberExpression";
import { PointerMemberExpression } from "../../parser/ast/expressions/PointerMemberExpression";
import { PostfixExpression } from "../../parser/ast/expressions/PostfixExpression";
import { PrefixExpression } from "../../parser/ast/expressions/PrefixExpression";
import { StringLiteralExpression } from "../../parser/ast/expressions/StringLiteral";
import { StructLiteralExpression } from "../../parser/ast/expressions/StructLiteralExpression";
import { BlockStatement } from "../../parser/ast/statements/BlockStatement";
import { ExpressionStatement } from "../../parser/ast/statements/ExpressionStatement";
import { ForStatement } from "../../parser/ast/statements/ForStatement";
import { FunctionStatement } from "../../parser/ast/statements/FunctionStatement";
import { IfStatement } from "../../parser/ast/statements/IfStatement";
import { LetStatement } from "../../parser/ast/statements/LetStatement";
import { ReturnStatement } from "../../parser/ast/statements/ReturnStatement";
import { SwitchStatement } from "../../parser/ast/statements/SwitchStatement";
import { TuplePattern } from "../../parser/ast/statements/TuplePattern";
import { WhileStatement } from "../../parser/ast/statements/WhileStatement";
import type { ASTExpression, ASTStatement } from "../../parser/ast/types/ast.type";
import { alignTo, type StructMember } from "../../shared/types";
import { getIntrinsic } from "../intrinsics";
import { minimumMemoryPages } from "../MapleModule";
import type { ModuleGraph, ModuleRecord } from "../module-graph";
import { canonicalFnType, isFnType, parseFnType, valueTypeToWasm } from "./emit.types";
import type {
  DeferredGlobalInit,
  FnSignature,
  FunctionMeta,
  StructData,
  VariableMeta,
} from "./emitter.types";
import { analyzeReachability, type ReachableSet } from "./reachability";

export type DeclarationEdges = {
  calls: string[];
  fnRefs: string[];
  globalReads: string[];
  globalWrites: string[];
  runtimeHelpers: string[];
  ownedData: string[];
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

export type MergedDataSegment = {
  id: string;
  moduleKey: string;
  sourceAddress: number;
  address: number;
  size: number;
  bytes: string;
  alignment: number;
  pointerOffsets: number[];
};

export type MergedDataAllocation = {
  id: string;
  moduleKey: string;
  owner: string;
  kind: "string" | "array" | "struct";
  address: number;
  segmentIds: string[];
};

export type MergedStartupInitializer = {
  id: string;
  moduleKey: string;
  owner: string;
  initializer: DeferredGlobalInit;
  targetAddress?: number;
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
  data: MergedDataSegment[];
  dataEnd: number;
  memoryMinimumPages: number;
  dataAddresses: Map<string, Map<number, number>>;
  dataAllocations: Map<string, MergedDataAllocation>;
  dataOwners: Map<string, string>;
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
    ownedData: [],
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

function segmentSize(bytes: string): number {
  return Math.floor(bytes.length / 3);
}

function bytesToI32(bytes: string, offset: number): number | undefined {
  const values = bytes
    .split("\\")
    .filter(Boolean)
    .map((value) => Number.parseInt(value, 16));
  if (values.length < offset + 4) return undefined;
  return (
    (values[offset] ?? 0) |
    ((values[offset + 1] ?? 0) << 8) |
    ((values[offset + 2] ?? 0) << 16) |
    ((values[offset + 3] ?? 0) << 24)
  );
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

  const data: MergedDataSegment[] = [];
  const dataAddresses = new Map<string, Map<number, number>>();
  const dataByModule = new Map<string, MergedDataSegment[]>();
  for (const module of orderedModules) {
    const addresses = new Map<number, number>();
    const moduleData: MergedDataSegment[] = [];
    dataAddresses.set(module.key, addresses);
    dataByModule.set(module.key, moduleData);
    for (let index = 0; index < module.data.data.length; index++) {
      const source = module.data.data[index]!;
      const entry: MergedDataSegment = {
        id: `${module.manglePrefix}$$data$${index}`,
        moduleKey: module.key,
        sourceAddress: source.addr,
        address: source.addr,
        size: segmentSize(source.bytes),
        bytes: source.bytes,
        alignment: source.alignment ?? 1,
        pointerOffsets: source.pointerOffsets ?? [],
      };
      data.push(entry);
      moduleData.push(entry);
      addresses.set(source.addr, source.addr);
    }
  }

  const declarations = new Map<string, MergedDeclaration>();
  const functions = new Map<string, MergedFunction>();
  const globals = new Map<string, MergedGlobal>();
  const dataAllocations = new Map<string, MergedDataAllocation>();
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

  function expressionType(
    module: ModuleRecord,
    scopes: Scope,
    expression: ASTExpression,
  ): string | undefined {
    if (expression instanceof Identifier) {
      const name = expression.tokenLiteral();
      const local = localType(scopes, name);
      if (local) return resolveType(module, local);
      const global = module.data.globals[name];
      if (global) return resolveType(module, global.type);
      const importedGlobal = importedTarget(module, name, "global");
      if (importedGlobal) return globals.get(importedGlobal)?.resolvedType;
      if (importKinds.get(module.key)?.get(name) === "struct") {
        return imports.get(mangledName(module, name));
      }
    }
    if (expression instanceof CallExpression) {
      const localResult = module.data.functions[expression.func]?.mapleResults[0];
      if (localResult) return resolveType(module, localResult);
      const importedFunction = importedTarget(module, expression.func, "func");
      if (importedFunction) return functions.get(importedFunction)?.resolvedResults[0];
    }
    if (expression instanceof StringLiteralExpression) return "string";
    if (expression instanceof ArrayLiteralExpression)
      return `${resolveType(module, expression.memberType)}[]`;
    if (expression instanceof StructLiteralExpression) return resolveType(module, expression.name);
    if (expression instanceof CastExpression) return resolveType(module, expression.targetType);
    if (expression instanceof IndexExpression) {
      const containerType = expressionType(module, scopes, expression.left);
      if (containerType?.endsWith("[]")) return containerType.slice(0, -2);
    }
    if (expression instanceof MemberExpression || expression instanceof PointerMemberExpression) {
      const parentType = expressionType(module, scopes, expression.parent)?.replace(/^\*/, "");
      if (parentType) return structs.get(parentType)?.members[expression.member]?.resolvedType;
    }
    if (expression instanceof AssignmentExpression) {
      return expressionType(module, scopes, expression.left);
    }
    if (expression instanceof PrefixExpression && expression.right) {
      return expressionType(module, scopes, expression.right);
    }
    if (expression instanceof PostfixExpression && expression.left) {
      return expressionType(module, scopes, expression.left);
    }
    return undefined;
  }

  function claimData(
    module: ModuleRecord,
    owner: MergedDeclaration,
    kind: MergedDataAllocation["kind"],
    sourceAddress: number,
  ): void {
    const address = dataAddresses.get(module.key)?.get(sourceAddress);
    if (address === undefined) return;
    const id = `${module.manglePrefix}$$allocation$${sourceAddress}`;
    pushUnique(owner.edges.ownedData, id);
    if (dataAllocations.has(id)) return;
    const segments = dataByModule.get(module.key) ?? [];
    const primary = [...segments]
      .reverse()
      .find((segment) => segment.sourceAddress === sourceAddress);
    const segmentIds = primary ? [primary.id] : [];
    if (primary && (kind === "string" || kind === "array")) {
      const payloadAddress = bytesToI32(primary.bytes, 4);
      const payload = segments.find(
        (segment) => segment.id !== primary.id && segment.sourceAddress === payloadAddress,
      );
      if (payload) segmentIds.unshift(payload.id);
    }
    dataAllocations.set(id, {
      id,
      moduleKey: module.key,
      owner: owner.name,
      kind,
      address,
      segmentIds,
    });
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

    function recordIdentifier(name: string, mode: "read" | "write", currentScopes: Scope): void {
      if (localType(currentScopes, name) !== undefined) return;
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
        const name = expression.tokenLiteral();
        recordIdentifier(name, "write", currentScopes);
        if (compound) recordIdentifier(name, "read", currentScopes);
        return;
      }
      if (expression instanceof IndexExpression) {
        ensureHelper({ name: "__elem_addr", kind: "array", calls: [], requirements: [] });
        addHelperEdge(owner, "__elem_addr");
        if (expression.left instanceof Identifier) {
          recordIdentifier(expression.left.tokenLiteral(), "write", currentScopes);
        }
        walkExpression(expression.left, currentScopes);
        walkExpression(expression.index, currentScopes);
        return;
      }
      if (expression instanceof MemberExpression || expression instanceof PointerMemberExpression) {
        if (expression.parent instanceof Identifier) {
          recordIdentifier(expression.parent.tokenLiteral(), "write", currentScopes);
        }
        walkExpression(expression.parent, currentScopes);
        return;
      }
      walkExpression(expression, currentScopes);
    }

    function walkExpression(expression: ASTExpression, currentScopes: Scope): void {
      if (expression instanceof Identifier) {
        recordIdentifier(expression.tokenLiteral(), "read", currentScopes);
        return;
      }
      if (expression instanceof CallExpression) {
        const lexicalType = localType(currentScopes, expression.func);
        if (lexicalType && isFnType(resolveType(module, lexicalType))) {
          registerFnType(lexicalType);
        } else if ((expression as ASTExpression).resolvedCallTarget?.kind === "field") {
          registerFnType(
            (
              (expression as ASTExpression).resolvedCallTarget as Extract<
                NonNullable<ASTExpression["resolvedCallTarget"]>,
                { kind: "field" }
              >
            ).fnType,
          );
        } else {
          const receiver = expression.args[0];
          if (receiver instanceof Identifier) {
            const sourceType = localType(currentScopes, receiver.tokenLiteral())?.replace(
              /^\*/,
              "",
            );
            const identity = sourceType ? resolveType(module, sourceType) : undefined;
            const prefix = sourceType ? `${sourceType}_` : "";
            const memberName =
              prefix && expression.func.startsWith(prefix)
                ? expression.func.slice(prefix.length)
                : undefined;
            const fieldType =
              identity && memberName
                ? structs.get(identity)?.members[memberName]?.resolvedType
                : undefined;
            if (fieldType) registerFnType(fieldType);
          }
        }
        if (
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
          const leftType = expressionType(module, currentScopes, expression.left);
          const rightType = expressionType(module, currentScopes, expression.right);
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
        claimData(module, owner, "string", expression.location);
        return;
      }
      if (expression instanceof ArrayLiteralExpression) {
        claimData(module, owner, "array", expression.location);
        for (const element of expression.elements) walkExpression(element, currentScopes);
        return;
      }
      if (expression instanceof StructLiteralExpression) {
        claimData(module, owner, "struct", expression.location);
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
    ? {
        id: `${memoryModule.manglePrefix}$$heap-init`,
        moduleKey: memoryModule.key,
        owner: mangledName(memoryModule, "heap_init"),
        initializer: {
          kind: "call",
          name: mangledName(memoryModule, "heap_init"),
          args: [{ type: "i32", value: 0 }],
        },
      }
    : undefined;
  for (const module of orderedModules) {
    for (let index = 0; index < module.data.deferredGlobalInits.length; index++) {
      const initializer = module.data.deferredGlobalInits[index]!;
      let sourceName = initializer.kind === "global" ? initializer.name : undefined;
      if (!sourceName && initializer.kind === "memory") {
        sourceName = module.ast.statements
          .find(
            (statement): statement is LetStatement =>
              statement instanceof LetStatement &&
              !(statement.pattern instanceof TuplePattern) &&
              statement.expression instanceof StructLiteralExpression &&
              statement.expression.location === initializer.baseAddr,
          )
          ?.pattern.tokenLiteral();
      }
      const owner = sourceName
        ? mangledName(module, sourceName)
        : `${module.manglePrefix}$$startup$${index}`;
      const mergedInitializer: MergedStartupInitializer = {
        id: `${module.manglePrefix}$$init$${index}`,
        moduleKey: module.key,
        owner,
        initializer,
      };
      if (initializer.kind === "memory") {
        const targetAddress = dataAddresses.get(module.key)?.get(initializer.baseAddr);
        if (targetAddress !== undefined) mergedInitializer.targetAddress = targetAddress;
      }
      startupInitializers.push(mergedInitializer);
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
    dataAllocations,
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

  const ownedSegmentIds = new Set<string>();
  const liveSegmentIds = new Set<string>();
  for (const allocation of dataAllocations.values()) {
    const ownerIsReachable =
      reachability.reachable.functions.has(allocation.owner) ||
      reachability.reachable.globals.has(allocation.owner);
    for (const segmentId of allocation.segmentIds) {
      ownedSegmentIds.add(segmentId);
      if (ownerIsReachable) liveSegmentIds.add(segmentId);
    }
  }
  const liveData = data.filter(
    (segment) => !ownedSegmentIds.has(segment.id) || liveSegmentIds.has(segment.id),
  );

  for (const addresses of dataAddresses.values()) addresses.clear();
  let dataCursor = 65536;
  for (const segment of liveData) {
    dataCursor = alignTo(dataCursor, segment.alignment);
    segment.address = dataCursor;
    dataAddresses.get(segment.moduleKey)?.set(segment.sourceAddress, segment.address);
    dataCursor += segment.size;
  }

  for (const allocation of dataAllocations.values()) {
    const address = dataAddresses.get(allocation.moduleKey)?.get(allocation.address);
    if (address !== undefined) allocation.address = address;
  }
  for (const startup of startupInitializers) {
    if (startup.initializer.kind === "call" && startup.id.endsWith("$$heap-init")) {
      startup.initializer.args[0]!.value = alignTo(dataCursor, 8);
    }
    if (startup.initializer.kind === "memory") {
      const targetAddress = dataAddresses.get(startup.moduleKey)?.get(startup.initializer.baseAddr);
      if (targetAddress !== undefined) startup.targetAddress = targetAddress;
    }
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
    data: liveData,
    dataEnd: dataCursor,
    memoryMinimumPages: minimumMemoryPages(dataCursor),
    dataAddresses,
    dataAllocations,
    dataOwners: reachability.dataOwners,
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
