// Minimal YAML for burner's own config files: block maps, block lists,
// flow lists of scalars, quoted/plain scalars, comments. Not a general YAML
// parser — anchors, multi-line strings and flow maps are not supported.

function parseScalar(raw) {
  const s = raw.trim();
  if (s === '' || s === '~' || s === 'null') return null;
  if (s === 'true') return true;
  if (s === 'false') return false;
  if (/^-?\d+(\.\d+)?([eE][-+]?\d+)?$/.test(s)) return Number(s);
  if (s.startsWith('"')) return JSON.parse(s);
  if (s.startsWith("'")) return s.slice(1, -1).replace(/''/g, "'");
  if (s.startsWith('[') && s.endsWith(']')) {
    const inner = s.slice(1, -1).trim();
    return inner ? splitFlow(inner).map(parseScalar) : [];
  }
  if (s === '{}') return {};
  return s;
}

function splitFlow(s) {
  const out = [];
  let cur = '';
  let quote = null;
  for (const ch of s) {
    if (quote) {
      cur += ch;
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      cur += ch;
    } else if (ch === ',') {
      out.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

function stripComment(line) {
  let quote = null;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quote) {
      if (ch === '\\' && quote === '"') i++;
      else if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '#' && (i === 0 || /\s/.test(line[i - 1]))) return line.slice(0, i);
  }
  return line;
}

function splitKey(text) {
  let quote = null;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (ch === '\\' && quote === '"') i++;
      else if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === ':' && (i + 1 === text.length || text[i + 1] === ' ')) {
      return [parseScalar(text.slice(0, i)), text.slice(i + 1)];
    }
  }
  return null;
}

export function parseYaml(text) {
  const lines = [];
  for (const raw of text.replace(/\r\n/g, '\n').split('\n')) {
    const line = stripComment(raw).replace(/\s+$/, '');
    if (!line.trim()) continue;
    lines.push({ indent: line.length - line.trimStart().length, text: line.trim() });
  }
  let i = 0;

  function block(indent) {
    if (i >= lines.length) return null;
    return lines[i].text.startsWith('- ') || lines[i].text === '-' ? list(lines[i].indent) : map(lines[i].indent);
  }

  function valueAfter(rest, parentIndent) {
    if (rest.trim() !== '') return parseScalar(rest);
    if (i < lines.length && lines[i].indent > parentIndent) return block(lines[i].indent);
    if (i < lines.length && lines[i].indent === parentIndent && lines[i].text.startsWith('- ')) return list(parentIndent);
    return null;
  }

  function map(indent) {
    const obj = {};
    while (i < lines.length && lines[i].indent === indent && !lines[i].text.startsWith('- ')) {
      const kv = splitKey(lines[i].text);
      if (!kv) throw new Error(`yaml: expected "key: value" at "${lines[i].text}"`);
      i++;
      obj[kv[0]] = valueAfter(kv[1], indent);
    }
    return obj;
  }

  function list(indent) {
    const arr = [];
    while (i < lines.length && lines[i].indent === indent && (lines[i].text.startsWith('- ') || lines[i].text === '-')) {
      const rest = lines[i].text.slice(1).trimStart();
      const kv = rest ? splitKey(rest) : null;
      if (kv) {
        // "- key: value" opens a map whose remaining keys sit at the item's content column.
        const childIndent = indent + (lines[i].text.length - rest.length);
        lines[i] = { indent: childIndent, text: rest };
        arr.push(map(childIndent));
      } else {
        i++;
        arr.push(valueAfter(rest, indent));
      }
    }
    return arr;
  }

  return block(0) ?? {};
}

const PLAIN = /^[A-Za-z_][A-Za-z0-9_.\-/ ]*$/;
const RESERVED = /^(true|false|null|~|yes|no|on|off)$/i;

function scalar(v) {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  const s = String(v);
  if (PLAIN.test(s) && !RESERVED.test(s) && !s.endsWith(' ')) return s;
  return JSON.stringify(s);
}

function isScalar(v) {
  return v === null || typeof v !== 'object';
}

export function stringifyYaml(value, indent = 0) {
  const pad = ' '.repeat(indent);
  if (Array.isArray(value)) {
    if (!value.length) return '[]';
    return value.map((item) => {
      if (isScalar(item)) return `${pad}- ${scalar(item)}`;
      if (Array.isArray(item)) return `${pad}-\n${stringifyYaml(item, indent + 2)}`;
      const body = stringifyYaml(item, indent + 2);
      return `${pad}- ${body.slice(indent + 2)}`;
    }).join('\n');
  }
  const entries = Object.entries(value ?? {}).filter(([, v]) => v !== undefined);
  if (!entries.length) return `${pad}{}`;
  return entries.map(([k, v]) => {
    const key = scalar(k);
    if (isScalar(v)) return `${pad}${key}: ${scalar(v)}`;
    if (Array.isArray(v)) {
      if (!v.length) return `${pad}${key}: []`;
      if (v.every(isScalar) && v.length <= 12) return `${pad}${key}: [${v.map(scalar).join(', ')}]`;
      return `${pad}${key}:\n${stringifyYaml(v, indent + 2)}`;
    }
    if (!Object.keys(v).length) return `${pad}${key}: {}`;
    return `${pad}${key}:\n${stringifyYaml(v, indent + 2)}`;
  }).join('\n');
}
