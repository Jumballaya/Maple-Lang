import type {
  MergedDataAllocation,
  MergedDeclaration,
  MergedFnTableEntry,
  MergedRuntimeHelper,
  MergedStartupInitializer,
} from "./merge-model";

export type ReachableSet = {
  functions: Set<string>;
  globals: Set<string>;
  runtimeHelpers: Set<string>;
};

type ReachabilityInput = {
  declarations: Map<string, MergedDeclaration>;
  exports: Map<string, string>;
  dataAllocations: Map<string, MergedDataAllocation>;
  startupInitializers: MergedStartupInitializer[];
  fnTableEntries: MergedFnTableEntry[];
  runtimeHelpers: Map<string, MergedRuntimeHelper>;
};

export type ReachabilityAnalysis = {
  reachable: ReachableSet;
  fnTableEntries: MergedFnTableEntry[];
  dataOwners: Map<string, string>;
};

export function analyzeReachability(input: ReachabilityInput): ReachabilityAnalysis {
  const reachable: ReachableSet = {
    functions: new Set(),
    globals: new Set(),
    runtimeHelpers: new Set(),
  };
  const pending: MergedDeclaration[] = [];

  function enqueueDeclaration(name: string): void {
    const declaration = input.declarations.get(name);
    if (!declaration) return;
    const reached = declaration.kind === "function" ? reachable.functions : reachable.globals;
    if (reached.has(name)) return;
    reached.add(name);
    pending.push(declaration);
  }

  function reachHelper(name: string): void {
    if (reachable.runtimeHelpers.has(name)) return;
    const helper = input.runtimeHelpers.get(name);
    if (!helper) return;
    reachable.runtimeHelpers.add(name);
    for (const call of helper.calls) enqueueDeclaration(call);
    for (const requirement of helper.requirements) reachHelper(requirement);
  }

  for (const target of input.exports.values()) enqueueDeclaration(target);
  for (const startup of input.startupInitializers) {
    enqueueDeclaration(startup.owner);
    if (startup.initializer.kind === "call") enqueueDeclaration(startup.initializer.name);
  }

  for (let index = 0; index < pending.length; index++) {
    const declaration = pending[index]!;
    for (const call of declaration.edges.calls) enqueueDeclaration(call);
    for (const fnRef of declaration.edges.fnRefs) enqueueDeclaration(fnRef);
    for (const global of declaration.edges.globalReads) enqueueDeclaration(global);
    for (const global of declaration.edges.globalWrites) enqueueDeclaration(global);
    for (const helper of declaration.edges.runtimeHelpers) reachHelper(helper);
  }

  const candidates = new Map(
    input.fnTableEntries.map((entry) => [entry.functionName, entry] as const),
  );
  const fnTableEntries: MergedFnTableEntry[] = [];
  const slotted = new Set<string>();
  for (const declaration of input.declarations.values()) {
    const reached =
      declaration.kind === "function"
        ? reachable.functions.has(declaration.name)
        : reachable.globals.has(declaration.name);
    if (!reached) continue;
    for (const fnRef of declaration.edges.fnRefs) {
      if (!reachable.functions.has(fnRef) || slotted.has(fnRef)) continue;
      const candidate = candidates.get(fnRef);
      if (!candidate) continue;
      slotted.add(fnRef);
      fnTableEntries.push({ ...candidate, slot: fnTableEntries.length });
    }
  }

  return {
    reachable,
    fnTableEntries,
    dataOwners: new Map(
      [...input.dataAllocations].map(([allocation, data]) => [allocation, data.owner]),
    ),
  };
}
