#!/usr/bin/env node
/* eslint-disable no-console */
// Static scan: verifies every `navigation.navigate('X', ...)` call in
// `app/src/screens/*.js` targets a route that is actually reachable from the
// caller's navigator. Catches bugs like calling `navigate('ProjectDetail')`
// from a drawer-level screen when `ProjectDetail` is only registered in a
// nested stack.

const fs = require('fs');
const path = require('path');
const parser = require('@babel/parser');
const traverseModule = require('@babel/traverse');
const traverse = traverseModule.default || traverseModule;

const APP_ROOT = path.resolve(__dirname, '..');
const APP_JS = path.join(APP_ROOT, 'App.js');
const SCREENS_DIR = path.join(APP_ROOT, 'src', 'screens');

const PARSE_OPTIONS = {
  sourceType: 'module',
  plugins: ['jsx', 'classProperties', 'optionalChaining', 'nullishCoalescingOperator'],
};

function parseFile(file) {
  const src = fs.readFileSync(file, 'utf8');
  return { src, ast: parser.parse(src, PARSE_OPTIONS) };
}

// Return the name of the nearest enclosing FunctionDeclaration /
// VariableDeclarator(ArrowFunctionExpression|FunctionExpression).
function enclosingFunctionName(nodePath) {
  let cur = nodePath;
  while (cur) {
    if (cur.isFunctionDeclaration()) return cur.node.id && cur.node.id.name;
    if (cur.isVariableDeclarator() && cur.node.id && cur.node.id.name) {
      const init = cur.node.init;
      if (init && (init.type === 'ArrowFunctionExpression' || init.type === 'FunctionExpression')) {
        return cur.node.id.name;
      }
    }
    cur = cur.parentPath;
  }
  return null;
}

function jsxNameToString(node) {
  if (!node) return null;
  if (node.type === 'JSXIdentifier') return node.name;
  if (node.type === 'JSXMemberExpression') {
    return `${jsxNameToString(node.object)}.${jsxNameToString(node.property)}`;
  }
  return null;
}

function getAttr(openingEl, name) {
  const a = openingEl.attributes.find((x) => x.type === 'JSXAttribute' && x.name && x.name.name === name);
  return a ? a.value : null;
}

function stringFromAttr(attr) {
  if (!attr) return null;
  if (attr.type === 'StringLiteral') return attr.value;
  if (attr.type === 'JSXExpressionContainer' && attr.expression.type === 'StringLiteral') return attr.expression.value;
  return null;
}

// From a `component={X}` attribute, return identifier name X.
function identFromAttr(attr) {
  if (!attr) return null;
  if (attr.type === 'JSXExpressionContainer' && attr.expression.type === 'Identifier') return attr.expression.name;
  return null;
}

// Find the first JSX element identifier rendered by an arrow/function body.
// Used for `children={() => <X ... />}` — returns 'X' or the first named
// descendant (handles wrappers like <ScreenErrorBoundary><CaptureStack /></>).
function firstMeaningfulJsxName(node) {
  if (!node) return null;
  if (node.type === 'JSXElement') {
    const tag = jsxNameToString(node.openingElement.name);
    if (tag && !['View', 'ScreenErrorBoundary'].includes(tag)) return tag;
    for (const c of node.children || []) {
      const found = firstMeaningfulJsxName(c);
      if (found) return found;
    }
    return tag;
  }
  if (node.type === 'JSXFragment') {
    for (const c of node.children || []) {
      const found = firstMeaningfulJsxName(c);
      if (found) return found;
    }
  }
  if (node.type === 'ArrowFunctionExpression' || node.type === 'FunctionExpression') {
    if (node.body.type === 'JSXElement' || node.body.type === 'JSXFragment') return firstMeaningfulJsxName(node.body);
    if (node.body.type === 'BlockStatement') {
      for (const s of node.body.body) {
        if (s.type === 'ReturnStatement' && s.argument) {
          const found = firstMeaningfulJsxName(s.argument);
          if (found) return found;
        }
      }
    }
    if (node.body.type === 'ParenthesizedExpression' && node.body.expression) return firstMeaningfulJsxName(node.body.expression);
  }
  return null;
}

function parseAppJs() {
  const { ast } = parseFile(APP_JS);

  const imports = {}; // identifier → source path
  const wrappers = {}; // wrapperIdentifier → inner screen identifier
  const navigators = {}; // funcName → Set<screenName>
  const nestedMap = {}; // drawer route name → nested navigator fn name (e.g. NewProject → CaptureStack)
  const componentByScreen = {}; // `${funcName}:${screenName}` → component identifier

  traverse(ast, {
    ImportDeclaration(p) {
      const src = p.node.source.value;
      for (const spec of p.node.specifiers) {
        if (spec.type === 'ImportDefaultSpecifier') imports[spec.local.name] = src;
      }
    },
    VariableDeclarator(p) {
      const id = p.node.id;
      const init = p.node.init;
      if (!id || id.type !== 'Identifier' || !init) return;
      if (init.type !== 'ArrowFunctionExpression' && init.type !== 'FunctionExpression') return;
      const inner = firstMeaningfulJsxName(init);
      if (inner) wrappers[id.name] = inner;
    },
    JSXElement(p) {
      const tag = jsxNameToString(p.node.openingElement.name);
      if (!tag) return;
      // Match Stack.Screen / Drawer.Screen / *.Screen registrations
      if (!/^[A-Z]\w*\.Screen$/.test(tag)) return;
      const navFn = enclosingFunctionName(p);
      if (!navFn) return;
      const nameAttr = stringFromAttr(getAttr(p.node.openingElement, 'name'));
      if (!nameAttr) return;
      navigators[navFn] = navigators[navFn] || new Set();
      navigators[navFn].add(nameAttr);

      const componentIdent = identFromAttr(getAttr(p.node.openingElement, 'component'));
      if (componentIdent) {
        componentByScreen[`${navFn}:${nameAttr}`] = componentIdent;
      } else {
        // children={() => <X />}
        const childrenAttr = getAttr(p.node.openingElement, 'children');
        if (childrenAttr && childrenAttr.type === 'JSXExpressionContainer') {
          const inner = firstMeaningfulJsxName(childrenAttr.expression);
          if (inner) componentByScreen[`${navFn}:${nameAttr}`] = inner;
        }
      }
    },
  });

  // Identify which drawer routes host a nested navigator fn. A drawer route
  // hosts a nested stack if its component resolves (via wrappers) to a name
  // that is itself a key in `navigators` (e.g. `CaptureStack`).
  const drawerFn = Object.keys(navigators).find((fn) => (navigators[fn].size > 0 && fn.toLowerCase().includes('appcontent'))) || 'AppContent';
  const drawerRoutes = navigators[drawerFn] ? Array.from(navigators[drawerFn]) : [];
  for (const route of drawerRoutes) {
    let comp = componentByScreen[`${drawerFn}:${route}`];
    // Unwrap one level of wrapper if present
    const seen = new Set();
    while (comp && wrappers[comp] && !seen.has(comp)) {
      seen.add(comp);
      comp = wrappers[comp];
    }
    if (comp && navigators[comp]) {
      nestedMap[route] = comp;
    }
  }

  // Map each screen file path → the navigator function that registers it.
  // Resolution: for each registered screen in each navigator, follow the
  // component identifier through `wrappers` until we reach an import whose
  // source points at a file under src/screens/.
  const screenFileToNav = {}; // absolute path → navigator fn name
  for (const [navFn, screenSet] of Object.entries(navigators)) {
    for (const screenName of screenSet) {
      let ident = componentByScreen[`${navFn}:${screenName}`];
      const seen = new Set();
      while (ident && wrappers[ident] && !seen.has(ident)) {
        seen.add(ident);
        ident = wrappers[ident];
      }
      if (!ident) continue;
      const src = imports[ident];
      if (!src) continue;
      // Resolve relative to App.js dir
      const absolute = path.resolve(path.dirname(APP_JS), src.endsWith('.js') ? src : src + '.js');
      if (absolute.startsWith(SCREENS_DIR)) {
        screenFileToNav[absolute] = navFn;
      }
    }
  }

  return { navigators, nestedMap, screenFileToNav, drawerFn };
}

// Collect primary-string-literal targets from arg0. Handles
// StringLiteral, ConditionalExpression mixing string literals, and
// LogicalExpressions with string literal branches.
function extractPrimaryTargets(arg) {
  if (!arg) return [];
  if (arg.type === 'StringLiteral') return [arg.value];
  if (arg.type === 'ConditionalExpression') {
    return [...extractPrimaryTargets(arg.consequent), ...extractPrimaryTargets(arg.alternate)];
  }
  if (arg.type === 'LogicalExpression') {
    return [...extractPrimaryTargets(arg.left), ...extractPrimaryTargets(arg.right)];
  }
  return [];
}

function extractNestedScreen(arg) {
  if (!arg || arg.type !== 'ObjectExpression') return null;
  const screenProp = arg.properties.find(
    (x) => x.type === 'ObjectProperty' && x.key && ((x.key.name === 'screen') || (x.key.value === 'screen')),
  );
  if (!screenProp || !screenProp.value) return null;
  if (screenProp.value.type === 'StringLiteral') return screenProp.value.value;
  return null;
}

function collectNavigateCalls(file) {
  const { ast } = parseFile(file);
  const calls = [];
  traverse(ast, {
    CallExpression(p) {
      const callee = p.node.callee;
      if (callee.type !== 'MemberExpression') return;
      if (callee.property.type !== 'Identifier' || callee.property.name !== 'navigate') return;
      const obj = callee.object;
      // Accept `navigation.navigate`, `nav.navigate`, `route.navigation.navigate` etc.
      if (obj.type !== 'Identifier' && obj.type !== 'MemberExpression') return;
      const primaries = extractPrimaryTargets(p.node.arguments[0]);
      if (primaries.length === 0) return; // not a literal call — skip
      const nested = extractNestedScreen(p.node.arguments[1]);
      calls.push({ line: p.node.loc.start.line, primaries, nested });
    },
  });
  return calls;
}

function main() {
  const { navigators, nestedMap, screenFileToNav, drawerFn } = parseAppJs();

  // Build reachable sets per navigator.
  // Drawer routes are reachable from any nested stack that lives inside them.
  const reachableByNav = {};
  for (const navFn of Object.keys(navigators)) {
    const set = new Set(navigators[navFn]);
    // If this navigator is nested inside a drawer, include drawer siblings.
    const drawerChildren = navigators[drawerFn] || new Set();
    for (const drawerRoute of drawerChildren) {
      if (nestedMap[drawerRoute] === navFn) {
        for (const sib of drawerChildren) set.add(sib);
      }
    }
    reachableByNav[navFn] = set;
  }

  const failures = [];

  for (const entry of fs.readdirSync(SCREENS_DIR)) {
    if (!entry.endsWith('.js')) continue;
    const full = path.join(SCREENS_DIR, entry);
    const navFn = screenFileToNav[full];
    if (!navFn) continue; // screen file not mounted in any navigator; skip
    const calls = collectNavigateCalls(full);
    const reachable = reachableByNav[navFn] || new Set();
    const relFile = path.relative(APP_ROOT, full).replace(/\\/g, '/');

    for (const call of calls) {
      for (const primary of call.primaries) {
        if (call.nested !== null && call.nested !== undefined) {
          // Nested form: primary must be a drawer route that hosts a nested navigator.
          const nestedNav = nestedMap[primary];
          if (!nestedNav) {
            failures.push(
              `${relFile}:${call.line} navigate('${primary}', { screen: '${call.nested}' }) — '${primary}' is not a drawer route with a nested navigator`,
            );
            continue;
          }
          const nestedChildren = navigators[nestedNav] || new Set();
          if (!nestedChildren.has(call.nested)) {
            failures.push(
              `${relFile}:${call.line} navigate('${primary}', { screen: '${call.nested}' }) — '${call.nested}' not registered in ${nestedNav}`,
            );
          }
        } else if (!reachable.has(primary)) {
          failures.push(
            `${relFile}:${call.line} navigate('${primary}') — target not reachable from ${navFn} (reachable: ${Array.from(reachable).sort().join(', ')})`,
          );
        }
      }
    }
  }

  if (failures.length > 0) {
    console.error('Navigation scan failed:');
    for (const f of failures) console.error('  ' + f);
    process.exit(1);
  }
  console.log(`Navigation scan OK — checked ${Object.keys(screenFileToNav).length} screen files, ${Object.keys(navigators).length} navigators.`);
}

if (require.main === module) {
  try {
    main();
  } catch (e) {
    console.error('Scanner error:', e.stack || e.message);
    process.exit(2);
  }
}

module.exports = { parseAppJs, collectNavigateCalls };
