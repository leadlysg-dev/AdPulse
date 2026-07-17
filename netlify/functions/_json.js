// Defensive JSON extraction from model output: strips code fences and
// leading prose, and repairs simple truncation by closing open strings,
// braces and brackets before giving up.
function parseJson(text) {
  let t = String(text || '').trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)(?:```|$)/);
  if (fence) t = fence[1].trim();
  const start = t.indexOf('{');
  if (start > 0) t = t.slice(start);
  try {
    return JSON.parse(t);
  } catch {
    // truncation repair: close an unterminated string, then unwound brackets
    let repaired = t;
    const quotes = (repaired.match(/(?<!\\)"/g) || []).length;
    if (quotes % 2 === 1) repaired += '"';
    const opens = [];
    let inStr = false;
    for (let i = 0; i < repaired.length; i++) {
      const c = repaired[i];
      if (c === '"' && repaired[i - 1] !== '\\') inStr = !inStr;
      if (inStr) continue;
      if (c === '{' || c === '[') opens.push(c);
      if (c === '}' || c === ']') opens.pop();
    }
    while (opens.length) repaired += opens.pop() === '{' ? '}' : ']';
    return JSON.parse(repaired);
  }
}

module.exports = { parseJson };
