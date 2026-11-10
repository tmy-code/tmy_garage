// The server image copies only some folders and installs only the production packages. Importing anything else from
// the server (a client file, a dev-only package) type-checks and passes the tests but crashes the container at start-up.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '../..');
const entry = join(root, 'src/server/main.ts');

function copiedFolders(): string[] {
  const dockerfile = readFileSync(join(root, 'Dockerfile'), 'utf8');
  const runtime = dockerfile.slice(dockerfile.lastIndexOf('\nFROM '));
  return [...runtime.matchAll(/^COPY\s+(src\/\S+)\s/gm)].map((m) => join(root, m[1]!));
}

function importsOf(file: string): { relative: string[]; packages: string[] } {
  const source = readFileSync(file, 'utf8');
  const specifiers = [...source.matchAll(/(?:from\s+|import\s*\(?\s*)['"]([^'"]+)['"]/g)].map((m) => m[1]!);
  return {
    relative: specifiers.filter((s) => s.startsWith('.')),
    packages: specifiers.filter((s) => !s.startsWith('.') && !s.startsWith('node:')),
  };
}

function reachableFromServer(): { files: Set<string>; packages: Set<string> } {
  const files = new Set<string>();
  const packages = new Set<string>();
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.pop()!;
    if (files.has(file)) continue;
    files.add(file);
    const found = importsOf(file);
    found.packages.forEach((p) => packages.add(p.startsWith('@') ? p.split('/').slice(0, 2).join('/') : p.split('/')[0]!));
    for (const spec of found.relative) {
      const target = resolve(dirname(file), spec);
      if (existsSync(target)) queue.push(target);
      else throw new Error(`${relative(root, file)} imports ${spec}, which does not exist`);
    }
  }
  return { files, packages };
}

describe('the server image', () => {
  const { files, packages } = reachableFromServer();

  it('contains every file the server imports', () => {
    const folders = copiedFolders();
    const missing = [...files].filter((f) => !folders.some((dir) => f === dir || f.startsWith(dir + '\\') || f.startsWith(dir + '/')));
    expect(missing.map((f) => relative(root, f))).toEqual([]);
  });

  it('only needs packages installed with --omit=dev', () => {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { dependencies?: Record<string, string> };
    const runtime = new Set(Object.keys(pkg.dependencies ?? {}));
    expect([...packages].filter((p) => !runtime.has(p))).toEqual([]);
  });
});
