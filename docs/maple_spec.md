# Grammar

```
LetStmt       := 'let' Ident ':' Type ('=' Expr)? ';'
FnDecl        := 'fn' Ident '(' Params? ')' RetType Block
StructDecl    := 'struct' Ident '{' StructEntries '}'
StructEntries := StructEntry (StructEntry)*
StructEntry   := Ident ':' Type ','

Params        := Param (',' Param)*
Param         := Ident ':' Type
RetType       := ( ':' Type )?
Type          := 'void' | 'i8' | 'u8' | 'f8' | 'i16' | 'u16' | 'f16' | 'i32' | 'u32' | 'f32' | Ident | '*'+ Ident

IfStmt        :=
ForStmt       :=
WhileStmt     :=
SwitchStmt    :=

Block         := '{' Stmt* '}'
Stmt          := IfStmt | ForStmt | WhileStmt | SwitchStmt | LetStmt | StructDecl | Assign ';' | Return ';' | Expr ';'
Assign        := LValue '=' Expr
LValue        := Ident | Expr '->' Ident | '*' Expr
Expr          := literals | Ident | Call | Unary(*, &, -) | Binary(+,-,*,/,==,!=,<,<=,>,>=) | Assign ';'
Call          := Ident '(' Args? ')'
```
