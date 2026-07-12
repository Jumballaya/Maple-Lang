import { CallExpression } from "../../../parser/ast/expressions/CallExpression";
import { PostfixExpression } from "../../../parser/ast/expressions/PostfixExpression";
import { BlockStatement } from "../../../parser/ast/statements/BlockStatement";
import { BreakStatement } from "../../../parser/ast/statements/BreakStatement";
import { ContinueStatement } from "../../../parser/ast/statements/ContinueStatement";
import { ExpressionStatement } from "../../../parser/ast/statements/ExpressionStatement";
import { ForStatement } from "../../../parser/ast/statements/ForStatement";
import { IfStatement } from "../../../parser/ast/statements/IfStatement";
import { LetStatement } from "../../../parser/ast/statements/LetStatement";
import { ReturnStatement } from "../../../parser/ast/statements/ReturnStatement";
import { SwitchStatement } from "../../../parser/ast/statements/SwitchStatement";
import { WhileStatement } from "../../../parser/ast/statements/WhileStatement";
import type { ASTStatement } from "../../../parser/ast/types/ast.type";
import { MapleError } from "../../errors";
import type { ModuleEmitter } from "../../ModuleEmitter";
import { fnTypeResultCount, isFnType } from "../emit.types";
import { emitExpression } from "../expression/expression";
import { toLvalue } from "../expression/lvalue";
import { emitBreakStatement } from "./break";
import { emitContinueStatement } from "./continue";
import { emitForStatement } from "./for";
import { emitIfStatement } from "./if";
import { emitLetStatement } from "./let";
import { emitSwitchStatement } from "./switch";
import { emitWhileStatement } from "./while";

function emitPostfixVoid(expr: PostfixExpression, emitter: ModuleEmitter): string {
  if (!expr.left) {
    const t = expr.token;
    throw new MapleError("[statement emitter] postfix has no target", t.line, t.col);
  }
  const lv = toLvalue(expr.left, emitter);
  const delta = expr.operator === "++" ? 1 : -1;
  return lv.store(`(${lv.lane}.add ${lv.load} (${lv.lane}.const ${delta}))`);
}

export function emitStatement(stmt: ASTStatement, emitter: ModuleEmitter): void {
  if (stmt instanceof BlockStatement) {
    emitter.pushScope();
    for (const s of stmt.statements) {
      emitStatement(s, emitter);
    }
    emitter.popScope();
    return;
  }

  if (stmt instanceof ReturnStatement) {
    const fn = emitter.ctx.fn;
    const frameSize = fn?.frameSize ?? 0;
    const returnValues = stmt.returnValues;
    const fnResultCount = emitter.ctx.mod.functions[fn?.name ?? ""]?.results.length ?? 0;
    if (returnValues.length > 0) {
      const hasRetTmp = !!emitter.getVar("__ret_tmp");
      if (returnValues.length === 1 && fnResultCount <= 1 && frameSize > 0 && hasRetTmp) {
        const val = emitExpression(returnValues[0]!, emitter);
        emitter.writer.line(`(local.set $__ret_tmp ${val})`);
        emitter.writer.line(
          `(global.set $__sp (i32.add (global.get $__sp) (i32.const ${frameSize})))`,
        );
        emitter.writer.line(`(return (local.get $__ret_tmp))`);
      } else if (returnValues.length === 1 && fnResultCount <= 1 && frameSize > 0) {
        // Keep emitter robust when type-checking is bypassed (e.g. emitter-only tests):
        // restore stack frame first, then return value directly.
        emitter.writer.line(
          `(global.set $__sp (i32.add (global.get $__sp) (i32.const ${frameSize})))`,
        );
        emitter.writer.line(`(return ${emitExpression(returnValues[0]!, emitter)})`);
      } else if (returnValues.length === 1 && fnResultCount <= 1) {
        emitter.writer.line(`(return ${emitExpression(returnValues[0]!, emitter)})`);
      } else if (frameSize > 0 && fnResultCount >= 2) {
        if (
          returnValues.length === 1 &&
          returnValues[0] instanceof CallExpression &&
          emitter.getCallReturnTypes(returnValues[0].func)?.length === fnResultCount
        ) {
          emitter.writer.line(emitExpression(returnValues[0], emitter));
          for (let i = fnResultCount - 1; i >= 0; i--) {
            emitter.writer.line(`(local.set $__mret_${i})`);
          }
        } else {
          for (let i = 0; i < returnValues.length; i++) {
            emitter.writer.line(
              `(local.set $__mret_${i} ${emitExpression(returnValues[i]!, emitter)})`,
            );
          }
        }
        emitter.writer.line(
          `(global.set $__sp (i32.add (global.get $__sp) (i32.const ${frameSize})))`,
        );
        const values = Array.from({ length: fnResultCount }, (_, i) => `(local.get $__mret_${i})`);
        emitter.writer.line(`(return ${values.join(" ")})`);
      } else {
        const returnValueWat = returnValues.map((expr) => emitExpression(expr, emitter)).join(" ");
        emitter.writer.line(`(return ${returnValueWat})`);
      }
      return;
    }
    if (frameSize > 0) {
      emitter.writer.line(
        `(global.set $__sp (i32.add (global.get $__sp) (i32.const ${frameSize})))`,
      );
    }
    emitter.writer.line(`(return)`);
    return;
  }
  if (stmt instanceof LetStatement) {
    emitLetStatement(stmt, emitter);
    return;
  }
  if (stmt instanceof IfStatement) {
    emitIfStatement(stmt, emitter);
    return;
  }
  if (stmt instanceof ExpressionStatement) {
    if (stmt.expression instanceof PostfixExpression) {
      // Void context: emit only the mutation; the old value is not needed and must
      // not be left on the WASM stack (which would corrupt subsequent instructions).
      emitter.writer.line(emitPostfixVoid(stmt.expression, emitter));
    } else if (stmt.expression instanceof CallExpression) {
      emitter.writer.line(emitExpression(stmt.expression, emitter));
      const returnTypes = emitter.getCallReturnTypes(stmt.expression.func);
      if (returnTypes) {
        for (let i = 0; i < returnTypes.length; i++) {
          emitter.writer.line("(drop)");
        }
      } else {
        const fnVar = emitter.getVar(stmt.expression.func);
        if (fnVar && isFnType(fnVar.type)) {
          const resultCount = fnTypeResultCount(fnVar.type);
          for (let i = 0; i < resultCount; i++) {
            emitter.writer.line("(drop)");
          }
        }
      }
    } else {
      emitter.writer.line(emitExpression(stmt.expression!, emitter));
    }
    return;
  }
  if (stmt instanceof WhileStatement) {
    emitWhileStatement(stmt, emitter);
    return;
  }
  if (stmt instanceof ForStatement) {
    emitForStatement(stmt, emitter);
    return;
  }
  if (stmt instanceof BreakStatement) {
    emitBreakStatement(stmt, emitter);
    return;
  }
  if (stmt instanceof ContinueStatement) {
    emitContinueStatement(stmt, emitter);
    return;
  }
  if (stmt instanceof SwitchStatement) {
    emitSwitchStatement(stmt, emitter);
    return;
  }

  const t = stmt.token;
  throw new MapleError(
    `[statement emitter] statement type: ${stmt.tokenLiteral()} not implemented`,
    t.line,
    t.col,
  );
}
