import type * as Monaco from 'monaco-editor';
import { parseSimpleAliases, type ParsedSqlAliases } from './sqlAliasParser';

export type SqlAutocompleteContextKind =
  | 'afterSelectKeyword'
  | 'afterFromKeyword'
  | 'afterJoinKeyword'
  | 'afterDot'
  | 'afterWhereKeyword'
  | 'afterOrderByKeyword'
  | 'afterGroupByKeyword'
  | 'selectWithFrom'
  | 'generic';

export interface SqlAutocompleteContext {
  aliases: ParsedSqlAliases;
  currentStatement: string;
  currentStatementBeforeCursor: string;
  dotObject?: string;
  dotPartial?: string;
  kind: SqlAutocompleteContextKind;
  replacementRange: Monaco.IRange;
  selectTemplateRange: Monaco.IRange;
  textBeforeCursor: string;
  typedToken: string;
  wordRange: Monaco.IRange;
}

interface StatementBounds {
  beforeCursor: string;
  fullStatement: string;
  startOffset: number;
}

interface KeywordMatch {
  index: number;
  kind: SqlAutocompleteContextKind;
}

export function getSqlAutocompleteContext(
  model: Monaco.editor.ITextModel,
  position: Monaco.Position,
): SqlAutocompleteContext {
  const bounds = getCurrentStatementBounds(model, position);
  const word = model.getWordUntilPosition(position);
  const wordRange = {
    startLineNumber: position.lineNumber,
    startColumn: word.startColumn,
    endLineNumber: position.lineNumber,
    endColumn: word.endColumn,
  };
  const selectTemplateStartOffset =
    bounds.startOffset + (bounds.beforeCursor.match(/^\s*/)?.[0].length ?? 0);
  const selectTemplateRange = buildRangeFromOffsets(
    model,
    selectTemplateStartOffset,
    model.getOffsetAt(position),
  );
  const aliases = parseSimpleAliases(bounds.fullStatement);
  const base = {
    aliases,
    currentStatement: bounds.fullStatement,
    currentStatementBeforeCursor: bounds.beforeCursor,
    selectTemplateRange,
    textBeforeCursor: bounds.beforeCursor,
    typedToken: word.word,
    wordRange,
  };

  const tableContext = matchTableContext(bounds.beforeCursor, model, position);
  if (tableContext) {
    return {
      ...base,
      kind: tableContext.keyword === 'join' ? 'afterJoinKeyword' : 'afterFromKeyword',
      replacementRange: tableContext.replacementRange,
      typedToken: tableContext.typedToken,
    };
  }

  const dotContext = matchDotContext(bounds.beforeCursor);
  if (dotContext) {
    return {
      ...base,
      dotObject: dotContext.objectRef,
      dotPartial: dotContext.partial,
      kind: 'afterDot',
      replacementRange: buildRange(position, dotContext.partial.length),
      typedToken: dotContext.partial,
    };
  }

  const bareSelect = matchBareSelect(bounds.beforeCursor);
  if (bareSelect) {
    if (/\bfrom\b/i.test(bounds.fullStatement)) {
      return {
        ...base,
        kind: 'selectWithFrom',
        replacementRange: wordRange,
        typedToken: word.word,
      };
    }

    return {
      ...base,
      kind: 'afterSelectKeyword',
      replacementRange: selectTemplateRange,
      typedToken: bareSelect.typedToken,
    };
  }

  const columnKeyword = findColumnKeywordContext(bounds.beforeCursor);
  if (columnKeyword && /\bfrom\b/i.test(bounds.fullStatement)) {
    return {
      ...base,
      kind: columnKeyword.kind,
      replacementRange: wordRange,
      typedToken: word.word,
    };
  }

  return {
    ...base,
    kind: 'generic',
    replacementRange: wordRange,
  };
}

export function isTableSuggestionContext(sqlBeforeCursor: string): boolean {
  const statement = getStatementBeforeCursor(sqlBeforeCursor);
  const tableMatch = statement.match(/\b(?:from|join)\s+([A-Za-z0-9_$."`]*)$/i);
  return Boolean(matchBareSelect(statement) || (tableMatch?.[1]?.length ?? 0) > 0);
}

function getCurrentStatementBounds(
  model: Monaco.editor.ITextModel,
  position: Monaco.Position,
): StatementBounds {
  const fullText = model.getValue();
  const offset = model.getOffsetAt(position);
  const startOffset = fullText.lastIndexOf(';', Math.max(0, offset - 1)) + 1;
  const nextSemicolon = fullText.indexOf(';', offset);
  const endOffset = nextSemicolon >= 0 ? nextSemicolon : fullText.length;

  return {
    beforeCursor: fullText.slice(startOffset, offset),
    fullStatement: fullText.slice(startOffset, endOffset),
    startOffset,
  };
}

function getStatementBeforeCursor(sqlBeforeCursor: string): string {
  const lastSemicolon = sqlBeforeCursor.lastIndexOf(';');
  return sqlBeforeCursor.slice(lastSemicolon + 1);
}

function matchBareSelect(statementBeforeCursor: string): { typedToken: string } | null {
  const match = statementBeforeCursor.match(/^\s*select(?:\s+([A-Za-z0-9_$."`]*))?$/i);
  if (!match) {
    return null;
  }

  return { typedToken: match[1] ?? '' };
}

function matchTableContext(
  statementBeforeCursor: string,
  model: Monaco.editor.ITextModel,
  position: Monaco.Position,
): { keyword: 'from' | 'join'; replacementRange: Monaco.IRange; typedToken: string } | null {
  const match = statementBeforeCursor.match(/\b(from|join)\s+([A-Za-z0-9_$."`]*)$/i);
  if (!match) {
    return null;
  }

  const typedToken = match[2] ?? '';
  const endOffset = model.getOffsetAt(position);
  const startOffset = Math.max(0, endOffset - typedToken.length);

  return {
    keyword: (match[1] ?? 'from').toLowerCase() === 'join' ? 'join' : 'from',
    replacementRange: buildRangeFromOffsets(model, startOffset, endOffset),
    typedToken,
  };
}

function matchDotContext(statementBeforeCursor: string): { objectRef: string; partial: string } | null {
  const match = statementBeforeCursor.match(/([A-Za-z_][A-Za-z0-9_$]*(?:\.[A-Za-z_][A-Za-z0-9_$]*)?)\.([A-Za-z0-9_$]*)$/);
  if (!match) {
    return null;
  }

  return {
    objectRef: match[1] ?? '',
    partial: match[2] ?? '',
  };
}

function findColumnKeywordContext(statementBeforeCursor: string): KeywordMatch | null {
  const matches: KeywordMatch[] = [
    ...findKeywordMatches(statementBeforeCursor, /\border\s+by\b/gi, 'afterOrderByKeyword'),
    ...findKeywordMatches(statementBeforeCursor, /\bgroup\s+by\b/gi, 'afterGroupByKeyword'),
    ...findKeywordMatches(statementBeforeCursor, /\bwhere\b/gi, 'afterWhereKeyword'),
    ...findKeywordMatches(statementBeforeCursor, /\b(?:select|having|on|and|or|set)\b/gi, 'selectWithFrom'),
  ];

  if (!matches.length) {
    return null;
  }

  const lastColumnKeyword = matches.sort((left, right) => right.index - left.index)[0];
  const lastTableKeywordIndex = findLastKeywordIndex(statementBeforeCursor, /\b(?:from|join)\b/gi);
  if (lastTableKeywordIndex > lastColumnKeyword.index) {
    return null;
  }

  return lastColumnKeyword;
}

function findKeywordMatches(
  text: string,
  pattern: RegExp,
  kind: SqlAutocompleteContextKind,
): KeywordMatch[] {
  const matches: KeywordMatch[] = [];
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    matches.push({ index: match.index, kind });
  }

  return matches;
}

function findLastKeywordIndex(text: string, pattern: RegExp): number {
  let lastIndex = -1;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    lastIndex = match.index;
  }

  return lastIndex;
}

function buildRange(position: Monaco.Position, tokenLength: number): Monaco.IRange {
  return {
    startLineNumber: position.lineNumber,
    startColumn: Math.max(1, position.column - tokenLength),
    endLineNumber: position.lineNumber,
    endColumn: position.column,
  };
}

function buildRangeFromOffsets(
  model: Monaco.editor.ITextModel,
  startOffset: number,
  endOffset: number,
): Monaco.IRange {
  const start = model.getPositionAt(startOffset);
  const end = model.getPositionAt(endOffset);

  return {
    startLineNumber: start.lineNumber,
    startColumn: start.column,
    endLineNumber: end.lineNumber,
    endColumn: end.column,
  };
}
