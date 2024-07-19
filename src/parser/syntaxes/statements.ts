import { AiScriptSyntaxError } from '../../error.js';
import { CALL_NODE, NODE } from '../utils.js';
import { TokenKind } from '../token.js';
import { parseBlock, parseParams, parseType } from './common.js';
import { parseExpr } from './expressions.js';

import type * as Ast from '../../node.js';
import type { ITokenStream } from '../streams/token-stream.js';

/**
 * ```abnf
 * Statement = VarDef / FnDef / Out / Return / Attr / Each / For / Loop
 *           / Break / Continue / Assign / Expr
 * ```
*/
export function parseStatement(s: ITokenStream): Ast.Node {
	const startPos = s.token.loc;

	switch (s.getKind()) {
		case TokenKind.VarKeyword:
		case TokenKind.LetKeyword: {
			return parseVarDef(s);
		}
		case TokenKind.At: {
			if (s.lookahead(1).kind === TokenKind.Identifier) {
				return parseFnDef(s);
			}
			break;
		}
		case TokenKind.Out: {
			return parseOut(s);
		}
		case TokenKind.ReturnKeyword: {
			return parseReturn(s);
		}
		case TokenKind.OpenSharpBracket: {
			return parseStatementWithAttr(s);
		}
		case TokenKind.EachKeyword: {
			return parseEach(s);
		}
		case TokenKind.ForKeyword: {
			return parseFor(s);
		}
		case TokenKind.LoopKeyword: {
			return parseLoop(s);
		}
		case TokenKind.DoKeyword: {
			return parseDoWhile(s);
		}
		case TokenKind.WhileKeyword: {
			return parseWhile(s);
		}
		case TokenKind.BreakKeyword: {
			s.next();
			return NODE('break', {}, startPos, s.token.loc);
		}
		case TokenKind.ContinueKeyword: {
			s.next();
			return NODE('continue', {}, startPos, s.token.loc);
		}
	}
	const expr = parseExpr(s, false);
	const assign = tryParseAssign(s, expr);
	if (assign) {
		return assign;
	}
	return expr;
}

export function parseDefStatement(s: ITokenStream): Ast.Node {
	switch (s.getKind()) {
		case TokenKind.VarKeyword:
		case TokenKind.LetKeyword: {
			return parseVarDef(s);
		}
		case TokenKind.At: {
			return parseFnDef(s);
		}
		default: {
			throw new AiScriptSyntaxError(`unexpected token: ${TokenKind[s.getKind()]}`, s.token.loc);
		}
	}
}

/**
 * ```abnf
 * BlockOrStatement = Block / Statement
 * ```
*/
export function parseBlockOrStatement(s: ITokenStream): Ast.Node {
	if (s.getKind() === TokenKind.OpenBrace) {
		const startPos = s.token.loc;
		const statements = parseBlock(s);
		return NODE('block', { statements }, startPos, s.token.loc);
	} else {
		return parseStatement(s);
	}
}

/**
 * ```abnf
 * VarDef = ("let" / "var") IDENT [":" Type] "=" Expr
 * ```
*/
function parseVarDef(s: ITokenStream): Ast.Node {
	const startPos = s.token.loc;

	let mut;
	switch (s.getKind()) {
		case TokenKind.LetKeyword: {
			mut = false;
			break;
		}
		case TokenKind.VarKeyword: {
			mut = true;
			break;
		}
		default: {
			throw new AiScriptSyntaxError(`unexpected token: ${TokenKind[s.getKind()]}`, s.token.loc);
		}
	}
	s.next();

	s.expect(TokenKind.Identifier);
	const name = s.token.value!;
	s.next();

	let type;
	if (s.getKind() === TokenKind.Colon) {
		s.next();
		type = parseType(s);
	}

	s.nextWith(TokenKind.Eq);

	if (s.getKind() === TokenKind.NewLine) {
		s.next();
	}

	const expr = parseExpr(s, false);

	return NODE('def', { name, varType: type, expr, mut, attr: [] }, startPos, s.token.loc);
}

/**
 * ```abnf
 * FnDef = "@" IDENT Params [":" Type] Block
 * ```
*/
function parseFnDef(s: ITokenStream): Ast.Node {
	const startPos = s.token.loc;

	s.nextWith(TokenKind.At);

	s.expect(TokenKind.Identifier);
	const name = s.token.value;
	s.next();

	const params = parseParams(s);

	let type;
	if (s.getKind() === TokenKind.Colon) {
		s.next();
		type = parseType(s);
	}

	const body = parseBlock(s);

	const endPos = s.token.loc;

	return NODE('def', {
		name,
		expr: NODE('fn', {
			args: params,
			retType: type,
			children: body,
		}, startPos, endPos),
		mut: false,
		attr: [],
	}, startPos, endPos);
}

/**
 * ```abnf
 * Out = "<:" Expr
 * ```
*/
function parseOut(s: ITokenStream): Ast.Node {
	const startPos = s.token.loc;

	s.nextWith(TokenKind.Out);
	const expr = parseExpr(s, false);

	return CALL_NODE('print', [expr], startPos, s.token.loc);
}

/**
 * ```abnf
 * Each = "each" "let" IDENT ("," / SPACE) Expr BlockOrStatement
 *      / "each" "(" "let" IDENT ("," / SPACE) Expr ")" BlockOrStatement
 * ```
*/
function parseEach(s: ITokenStream): Ast.Node {
	const startPos = s.token.loc;
	let hasParen = false;

	s.nextWith(TokenKind.EachKeyword);

	if (s.getKind() === TokenKind.OpenParen) {
		hasParen = true;
		s.next();
	}

	s.nextWith(TokenKind.LetKeyword);

	s.expect(TokenKind.Identifier);
	const name = s.token.value!;
	s.next();

	if (s.getKind() === TokenKind.Comma) {
		s.next();
	} else {
		throw new AiScriptSyntaxError('separator expected', s.token.loc);
	}

	const items = parseExpr(s, false);

	if (hasParen) {
		s.nextWith(TokenKind.CloseParen);
	}

	const body = parseBlockOrStatement(s);

	return NODE('each', {
		var: name,
		items: items,
		for: body,
	}, startPos, s.token.loc);
}

function parseFor(s: ITokenStream): Ast.Node {
	const startPos = s.token.loc;
	let hasParen = false;

	s.nextWith(TokenKind.ForKeyword);

	if (s.getKind() === TokenKind.OpenParen) {
		hasParen = true;
		s.next();
	}

	if (s.getKind() === TokenKind.LetKeyword) {
		// range syntax
		s.next();

		const identPos = s.token.loc;

		s.expect(TokenKind.Identifier);
		const name = s.token.value!;
		s.next();

		let _from;
		if (s.getKind() === TokenKind.Eq) {
			s.next();
			_from = parseExpr(s, false);
		} else {
			_from = NODE('num', { value: 0 }, identPos, identPos);
		}

		if (s.getKind() === TokenKind.Comma) {
			s.next();
		} else {
			throw new AiScriptSyntaxError('separator expected', s.token.loc);
		}

		const to = parseExpr(s, false);

		if (hasParen) {
			s.nextWith(TokenKind.CloseParen);
		}

		const body = parseBlockOrStatement(s);

		return NODE('for', {
			var: name,
			from: _from,
			to,
			for: body,
		}, startPos, s.token.loc);
	} else {
		// times syntax

		const times = parseExpr(s, false);

		if (hasParen) {
			s.nextWith(TokenKind.CloseParen);
		}
	
		const body = parseBlockOrStatement(s);

		return NODE('for', {
			times,
			for: body,
		}, startPos, s.token.loc);
	}
}

/**
 * ```abnf
 * Return = "return" Expr
 * ```
*/
function parseReturn(s: ITokenStream): Ast.Node {
	const startPos = s.token.loc;

	s.nextWith(TokenKind.ReturnKeyword);
	const expr = parseExpr(s, false);

	return NODE('return', { expr }, startPos, s.token.loc);
}

/**
 * ```abnf
 * StatementWithAttr = *Attr Statement
 * ```
*/
function parseStatementWithAttr(s: ITokenStream): Ast.Node {
	const attrs: Ast.Attribute[] = [];
	while (s.getKind() === TokenKind.OpenSharpBracket) {
		attrs.push(parseAttr(s) as Ast.Attribute);
		s.nextWith(TokenKind.NewLine);
	}

	const statement = parseStatement(s);

	if (statement.type !== 'def') {
		throw new AiScriptSyntaxError('invalid attribute.', statement.loc.start);
	}
	if (statement.attr != null) {
		statement.attr.push(...attrs);
	} else {
		statement.attr = attrs;
	}

	return statement;
}

/**
 * ```abnf
 * Attr = "#[" IDENT [StaticExpr] "]"
 * ```
*/
function parseAttr(s: ITokenStream): Ast.Node {
	const startPos = s.token.loc;

	s.nextWith(TokenKind.OpenSharpBracket);

	s.expect(TokenKind.Identifier);
	const name = s.token.value!;
	s.next();

	let value;
	if (s.getKind() !== TokenKind.CloseBracket) {
		value = parseExpr(s, true);
	} else {
		const closePos = s.token.loc;
		value = NODE('bool', { value: true }, closePos, closePos);
	}

	s.nextWith(TokenKind.CloseBracket);

	return NODE('attr', { name, value }, startPos, s.token.loc);
}

/**
 * ```abnf
 * Loop = "loop" Block
 * ```
*/
function parseLoop(s: ITokenStream): Ast.Node {
	const startPos = s.token.loc;

	s.nextWith(TokenKind.LoopKeyword);
	const statements = parseBlock(s);

	return NODE('loop', { statements }, startPos, s.token.loc);
}

/**
 * ```abnf
 * Loop = "do" BlockOrStatement "while" Expr
 * ```
*/
function parseDoWhile(s: ITokenStream): Ast.Node {
	const doStartPos = s.token.loc;
	s.nextWith(TokenKind.DoKeyword);
	const body = parseBlockOrStatement(s);
	const whilePos = s.token.loc;
	s.nextWith(TokenKind.WhileKeyword);
	const cond = parseExpr(s, false);
	const endPos = s.token.loc;

	return NODE('loop', {
		statements: [
			body,
			NODE('if', {
				cond: NODE('not', { expr: cond }, whilePos, endPos),
				then: NODE('break', {}, endPos, endPos),
				elseif: [],
			}, whilePos, endPos),
		],
	}, doStartPos, endPos);
}

/**
 * ```abnf
 * Loop = "while" Expr BlockOrStatement
 * ```
*/
function parseWhile(s: ITokenStream): Ast.Node {
	const startPos = s.token.loc;
	s.nextWith(TokenKind.WhileKeyword);
	const cond = parseExpr(s, false);
	const condEndPos = s.token.loc;
	const body = parseBlockOrStatement(s);

	return NODE('loop', {
		statements: [
			NODE('if', {
				cond: NODE('not', { expr: cond }, startPos, condEndPos),
				then: NODE('break', {}, condEndPos, condEndPos),
				elseif: [],
			}, startPos, condEndPos),
			body,
		],
	}, startPos, s.token.loc);
}

/**
 * ```abnf
 * Assign = Expr ("=" / "+=" / "-=") Expr
 * ```
*/
function tryParseAssign(s: ITokenStream, dest: Ast.Node): Ast.Node | undefined {
	const loc = s.token.loc;

	// Assign
	switch (s.getKind()) {
		case TokenKind.Eq: {
			s.next();
			const expr = parseExpr(s, false);
			return NODE('assign', { dest, expr }, loc, s.token.loc);
		}
		case TokenKind.PlusEq: {
			s.next();
			const expr = parseExpr(s, false);
			return NODE('addAssign', { dest, expr }, loc, s.token.loc);
		}
		case TokenKind.MinusEq: {
			s.next();
			const expr = parseExpr(s, false);
			return NODE('subAssign', { dest, expr }, loc, s.token.loc);
		}
		default: {
			return;
		}
	}
}
