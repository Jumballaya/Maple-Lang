import type { IrModule } from "./ir";

export type IrPass = (module: IrModule) => void;

export function runPasses(module: IrModule, passes: readonly IrPass[]): IrModule {
  for (const pass of passes) pass(module);
  return module;
}
