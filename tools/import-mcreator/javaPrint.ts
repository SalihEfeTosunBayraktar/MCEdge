// Prints a syntax tree of java-ast/JavaAst.java as compact Java text without spaces (types and names kept), so the
// code MCreator generates for one template compares equal wherever it appears. The converter accepts a template only
// when its text equals the one it was written against; any other variant stays Java.
import type { Ast } from "./java2blocks.ts";

const BINARY: Record<string, string> = {
  PLUS: "+", MINUS: "-", MULTIPLY: "*", DIVIDE: "/", REMAINDER: "%", EQUAL_TO: "==", NOT_EQUAL_TO: "!=", LESS_THAN: "<",
  LESS_THAN_EQUAL: "<=", GREATER_THAN: ">", GREATER_THAN_EQUAL: ">=", CONDITIONAL_AND: "&&", CONDITIONAL_OR: "||",
  AND: "&", OR: "|", XOR: "^", LEFT_SHIFT: "<<", RIGHT_SHIFT: ">>",
};
const ASSIGN: Record<string, string> = { ASSIGNMENT: "=", PLUS_ASSIGNMENT: "+=", MINUS_ASSIGNMENT: "-=", MULTIPLY_ASSIGNMENT: "*=", DIVIDE_ASSIGNMENT: "/=" };
const LITERAL_SUFFIX: Record<string, string> = { LONG_LITERAL: "L", FLOAT_LITERAL: "f" };

/** A variable declaration without its semicolon: parameters, lambda parameters, loop variables. */
const declaration = (node: Ast): string => `${java(node.type)} ${node.name}${node.initializer ? `=${java(node.initializer)}` : ""}`;
const list = (nodes: Ast[] | undefined, separator = ","): string => (nodes ?? []).map(java).join(separator);

/** Java text of a tree node. */
export function java(node: Ast | null | undefined): string {
  if (!node) return "";
  switch (node.k) {
    case "IDENTIFIER": return node.name;
    case "MEMBER_SELECT": return `${java(node.expression)}.${node.identifier}`;
    case "METHOD_INVOCATION": return `${java(node.methodSelect)}(${list(node.arguments)})`;
    case "PARENTHESIZED": return `(${java(node.expression)})`;
    case "TYPE_CAST": return `(${java(node.type)})${java(node.expression)}`;
    case "NEW_CLASS": return `new ${java(node.identifier)}(${list(node.arguments)})${node.classBody ? `{${list(node.classBody.members, "")}}` : ""}`;
    case "INT_LITERAL": case "DOUBLE_LITERAL": case "LONG_LITERAL": case "FLOAT_LITERAL": return `${node.value}${LITERAL_SUFFIX[node.k] ?? ""}`;
    case "STRING_LITERAL": return JSON.stringify(node.value);
    case "BOOLEAN_LITERAL": return String(node.value);
    case "NULL_LITERAL": return "null";
    case "PRIMITIVE_TYPE": return String(node.primitiveTypeKind).toLowerCase();
    case "PARAMETERIZED_TYPE": return `${java(node.type)}<${list(node.typeArguments)}>`;
    case "UNBOUNDED_WILDCARD": return "?";
    case "UNARY_MINUS": return `-${java(node.expression)}`;
    case "LOGICAL_COMPLEMENT": return `!${java(node.expression)}`;
    case "POSTFIX_INCREMENT": return `${java(node.expression)}++`;
    case "POSTFIX_DECREMENT": return `${java(node.expression)}--`;
    case "PREFIX_INCREMENT": return `++${java(node.expression)}`;
    case "CONDITIONAL_EXPRESSION": return `${java(node.condition)}?${java(node.trueExpression)}:${java(node.falseExpression)}`;
    case "INSTANCE_OF": return `${java(node.expression)} instanceof ${java(node.type)}`;
    case "LAMBDA_EXPRESSION": return `(${(node.parameters ?? []).map(declaration).join(",")})->${java(node.body)}`;
    case "VARIABLE": return `${declaration(node)};`;
    case "EXPRESSION_STATEMENT": return `${java(node.expression)};`;
    case "BLOCK": return `{${list(node.statements, "")}}`;
    case "IF": return `if(${java(node.condition)})${java(node.thenStatement)}${node.elseStatement ? `else ${java(node.elseStatement)}` : ""}`;
    case "RETURN": return `return ${java(node.expression)};`;
    case "EMPTY_STATEMENT": return ";";
    case "BREAK": return "break;";
    case "CONTINUE": return "continue;";
    case "WHILE_LOOP": return `while(${java(node.condition)})${java(node.statement)}`;
    case "FOR_LOOP": return `for(${list(node.initializer, "")}${java(node.condition)};${list((node.update ?? []).map((u: Ast) => u.expression))})${java(node.statement)}`;
    case "ENHANCED_FOR_LOOP": return `for(${declaration(node.variable)}:${java(node.expression)})${java(node.statement)}`;
    case "TRY": return `try${java(node.block)}${list(node.catches, "")}${node.finallyBlock ? `finally${java(node.finallyBlock)}` : ""}`;
    case "CATCH": return `catch(${declaration(node.parameter)})${java(node.block)}`;
    case "CLASS": return `class{${list(node.members, "")}}`;
    case "MODIFIERS": return "";
    case "METHOD": return `${(node.modifiers?.flags ?? []).join(" ")} ${java(node.returnType)} ${node.name}(${(node.parameters ?? []).map(declaration).join(",")})${java(node.body)}`;
    default:
      if (BINARY[node.k]) return `${java(node.leftOperand)}${BINARY[node.k]}${java(node.rightOperand)}`;
      if (ASSIGN[node.k]) return `${java(node.variable)}${ASSIGN[node.k]}${java(node.expression)}`;
      return `<${node.k}>`;
  }
}
