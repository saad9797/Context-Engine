'use strict';
// Parses source only. Never imports, evaluates, or executes customer modules.
const parser = require('@babel/parser');

function bindings(node, out = []) {
  if (!node) return out;
  if (node.type === 'Identifier') out.push(node.name);
  else if (node.type === 'ObjectPattern') node.properties.forEach(p => bindings(p.value || p.argument, out));
  else if (node.type === 'ArrayPattern') node.elements.forEach(p => bindings(p, out));
  else if (node.type === 'AssignmentPattern') bindings(node.left, out);
  else if (node.type === 'RestElement') bindings(node.argument, out);
  return out;
}

function names(node) {
  if (node.declaration) return names(node.declaration);
  if (node.id) return bindings(node.id);
  if (node.declarations) return node.declarations.flatMap(d => bindings(d.id));
  return [];
}

function refs(node, out = new Set(), parent = null, key = '') {
  if (!node || typeof node !== 'object') return out;
  // JSX tags are bindings too: <InvoiceForm/> and <UI.Dialog/>.
  if (node.type === 'JSXIdentifier' && /^[A-Z]/.test(node.name) && parent &&
      (['JSXOpeningElement', 'JSXClosingElement'].includes(parent.type) && key === 'name' || parent.type === 'JSXMemberExpression' && key === 'object')) out.add(node.name);
  if (node.type === 'Identifier' && !(parent &&
      ((parent.type === 'MemberExpression' || parent.type === 'OptionalMemberExpression') && key === 'property' && !parent.computed ||
       (parent.type === 'ObjectProperty' || parent.type === 'ObjectMethod') && key === 'key' && !parent.computed && !parent.shorthand))) out.add(node.name);
  for (const [k, value] of Object.entries(node)) {
    if (['loc', 'comments', 'leadingComments', 'trailingComments', 'tokens'].includes(k)) continue;
    if (Array.isArray(value)) value.forEach(v => refs(v, out, node, k));
    else if (value && typeof value === 'object') refs(value, out, node, k);
  }
  return out;
}

function members(node, result = {}) {
  if (!node || typeof node !== 'object') return result;
  if (['MemberExpression', 'OptionalMemberExpression', 'JSXMemberExpression'].includes(node.type) && ['Identifier', 'JSXIdentifier'].includes(node.object.type)) {
    const name = !node.computed ? node.property.name : node.property.type === 'StringLiteral' ? node.property.value : null;
    if (name) (result[node.object.name] ||= []).push(name);
  }
  for (const [key, value] of Object.entries(node)) {
    if (['loc', 'comments', 'leadingComments', 'trailingComments', 'tokens'].includes(key)) continue;
    if (Array.isArray(value)) value.forEach(v => members(v, result));
    else if (value && typeof value === 'object') members(value, result);
  }
  return result;
}

function extract(file) {
  const {path, content} = file;
  try {
    const ts = /\.[cm]?tsx?$/.test(path);
    const plugins = [ts ? 'typescript' : 'flow', 'jsx', 'decorators-legacy'];
    const tree = parser.parse(content, {sourceType: 'unambiguous', plugins, errorRecovery: false});
    const imports = [], units = [];
    for (const node of tree.program.body) {
      if (node.type === 'ImportDeclaration' || node.source && node.type.startsWith('Export')) {
        const items = (node.specifiers || []).map(s => ({local: node.type.startsWith('Export') ? s.exported?.name || s.local?.name : s.local?.name,
          imported: s.imported?.name || (s.type === 'ImportDefaultSpecifier' ? 'default' : s.type === 'ImportNamespaceSpecifier' ? '*' : s.local?.name || '*')}));
        imports.push({module: node.source.value, bindings: items, content: content.slice(node.start, node.end),
          side_effect: !items.length, reexport: node.type.startsWith('Export')});
        continue;
      }
      const symbols = names(node);
      if (node.type === 'ExportDefaultDeclaration') symbols.push('default');
      const start = node.leadingComments?.length ? node.leadingComments[0].start : node.start;
      units.push({start_line: (node.leadingComments?.[0]?.loc || node.loc).start.line,
        end_line: node.loc.end.line, content: content.slice(start, node.end), symbols,
        refs: [...refs(node)].sort(), members: members(node)});
      // CommonJS require bindings; the declaration remains a complete unit.
      for (const declaration of node.declarations || []) {
        const init = declaration.init;
        if (init?.type === 'CallExpression' && init.callee.name === 'require' && init.arguments[0]?.type === 'StringLiteral') {
          const items = declaration.id.type === 'ObjectPattern'
            ? declaration.id.properties.map(p => ({local: p.value?.name, imported: p.key?.name})).filter(p => p.local)
            : bindings(declaration.id).map(local => ({local, imported: '*'}));
          imports.push({module: init.arguments[0].value, bindings: items,
            content: content.slice(node.start, node.end), side_effect: false});
        }
      }
    }
    return {path, imports, units};
  } catch (error) {
    return {path, imports: [], units: [], parse_error: 'JS/TS syntax could not be parsed; whole-file fallback used.'};
  }
}

if (require.main === module) {
  let input = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', chunk => { input += chunk; if (Buffer.byteLength(input) > 48 * 1024 * 1024) process.exit(2); });
  process.stdin.on('end', () => {
    try {
      const files = JSON.parse(input);
      if (!Array.isArray(files) || files.length > 1200) throw Error('Input limit');
      process.stdout.write(JSON.stringify(files.map(extract)));
    } catch { process.stderr.write('Source indexing failed'); process.exitCode = 2; }
  });
}
module.exports = {extract};
