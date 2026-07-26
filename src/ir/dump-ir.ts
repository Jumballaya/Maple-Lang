import type { IrModule } from "./ir";

function compareMapKeys(left: unknown, right: unknown): number {
  if (typeof left === "number" && typeof right === "number") return left - right;
  const leftString = String(left);
  const rightString = String(right);
  if (leftString < rightString) return -1;
  if (leftString > rightString) return 1;
  return 0;
}

function replacer(_key: string, value: unknown): unknown {
  if (typeof value === "bigint") return { $bigint: value.toString() };
  if (value instanceof Map) {
    return Object.fromEntries(
      [...value.entries()].sort(([left], [right]) => compareMapKeys(left, right)),
    );
  }
  if (value instanceof Uint8Array) {
    return { $bytes: [...value].map((byte) => byte.toString(16).padStart(2, "0")).join("") };
  }
  return value;
}

export function dumpIr(module: IrModule): string {
  return `${JSON.stringify(module, replacer, 2)}\n`;
}
