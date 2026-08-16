/**
 * Lightweight syntax highlighting for the three languages the bank actually
 * uses: C#, JavaScript and XML. Deliberately a hand-rolled tokeniser rather
 * than a dependency — the code blocks are short, the classes already exist in
 * `styles.css`, and a highlighter is 200 KB to solve a 100-line problem.
 *
 * It is a lexer, not a parser. It will not colour a pathological case
 * correctly; it will never throw or lose a character.
 */
import { Fragment } from 'react';

export type CodeLang = 'csharp' | 'javascript' | 'xml';

interface Tok {
  cls: string | null;
  text: string;
}

const CSHARP_KEYWORDS = new Set(
  ('abstract as async await base bool break byte case catch char checked class const continue decimal ' +
    'default delegate do double else enum event explicit extern false finally fixed float for foreach get ' +
    'goto if implicit in int interface internal is lock long namespace new null object operator out ' +
    'override params private protected public readonly ref return sbyte sealed set short sizeof stackalloc ' +
    'static string struct switch this throw true try typeof uint ulong unchecked unsafe ushort using var ' +
    'virtual void volatile while yield').split(' '),
);

const JS_KEYWORDS = new Set(
  ('async await break case catch class const continue debugger default delete do else export extends ' +
    'false finally for from function get if import in instanceof let new null of return set static super ' +
    'switch this throw true try typeof undefined var void while with yield').split(' '),
);

/** Names that read as types rather than values, so they get their own colour. */
const isTypeName = (word: string): boolean => /^[A-Z][A-Za-z0-9_]*$/.test(word);

const CODE_RE = new RegExp(
  [
    '(\\/\\/[^\\n]*|\\/\\*[\\s\\S]*?\\*\\/)', // 1 comment
    '(@"(?:[^"]|"")*"|"(?:\\\\.|[^"\\\\])*"|\'(?:\\\\.|[^\'\\\\])*\'|`(?:\\\\.|[^`\\\\])*`)', // 2 string
    '(\\b\\d[\\w.]*\\b)', // 3 number
    '([A-Za-z_$][A-Za-z0-9_$]*)', // 4 word
  ].join('|'),
  'g',
);

const XML_RE = new RegExp(
  [
    '(<!--[\\s\\S]*?-->)', // 1 comment
    '(<[?!/]?[A-Za-z_][\\w.:-]*|\\/?>|\\?>)', // 2 tag
    '("(?:[^"]*)"|\'(?:[^\']*)\')', // 3 attribute value
    '([A-Za-z_][\\w.:-]*)(?=\\s*=)', // 4 attribute name
  ].join('|'),
  'g',
);

const walk = (
  code: string,
  re: RegExp,
  classify: (groups: (string | undefined)[]) => Tok | null,
): Tok[] => {
  const out: Tok[] = [];
  let last = 0;
  re.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code)) !== null) {
    if (m.index > last) out.push({ cls: null, text: code.slice(last, m.index) });
    const tok = classify(m.slice(1));
    out.push(tok ?? { cls: null, text: m[0] });
    last = m.index + m[0].length;
    if (m[0].length === 0) re.lastIndex++; // never spin on a zero-width match
  }
  if (last < code.length) out.push({ cls: null, text: code.slice(last) });
  return out;
};

const tokeniseCurly = (code: string, keywords: Set<string>): Tok[] =>
  walk(code, CODE_RE, ([comment, str, num, word]) => {
    if (comment !== undefined) return { cls: 'tok-com', text: comment };
    if (str !== undefined) return { cls: 'tok-str', text: str };
    if (num !== undefined) return { cls: 'tok-num', text: num };
    if (word !== undefined) {
      if (keywords.has(word)) return { cls: 'tok-key', text: word };
      if (isTypeName(word)) return { cls: 'tok-type', text: word };
      return { cls: null, text: word };
    }
    return null;
  });

const tokeniseXml = (code: string): Tok[] =>
  walk(code, XML_RE, ([comment, tag, value, attr]) => {
    if (comment !== undefined) return { cls: 'tok-com', text: comment };
    if (tag !== undefined) return { cls: 'tok-tag', text: tag };
    if (value !== undefined) return { cls: 'tok-str', text: value };
    if (attr !== undefined) return { cls: 'tok-attr', text: attr };
    return null;
  });

export const tokenise = (code: string, lang: CodeLang): Tok[] => {
  switch (lang) {
    case 'xml':
      return tokeniseXml(code);
    case 'csharp':
      return tokeniseCurly(code, CSHARP_KEYWORDS);
    case 'javascript':
      return tokeniseCurly(code, JS_KEYWORDS);
  }
};

/**
 * The bank does not tag its code blocks with a language, so it is inferred.
 * Wrong guesses only cost colour, never content.
 */
export const detectLanguage = (code: string): CodeLang => {
  const t = code.trim();
  if (t.startsWith('<') && /<\/[A-Za-z]|\/>|<\?xml/.test(t)) return 'xml';
  if (
    /\b(using\s+System|namespace\s+[A-Za-z]|public\s+(sealed\s+|partial\s+|static\s+)?class|IPlugin|IOrganizationService|ITracingService|IServiceProvider|EntityReference|QueryExpression)\b/.test(
      t,
    )
  ) {
    return 'csharp';
  }
  return 'javascript';
};

export function CodeBlock({
  code,
  language,
  label,
}: {
  code: string;
  language?: CodeLang;
  label?: string;
}) {
  const lang = language ?? detectLanguage(code);
  const toks = tokenise(code, lang);
  return (
    <div className="stack" style={{ gap: 6 }}>
      <span className="label">{label ?? `Code — ${lang === 'csharp' ? 'C#' : lang}`}</span>
      <pre className="code" data-lang={lang}>
        <code>
          {toks.map((t, i) => (
            <Fragment key={i}>
              {t.cls ? <span className={t.cls}>{t.text}</span> : t.text}
            </Fragment>
          ))}
        </code>
      </pre>
    </div>
  );
}
