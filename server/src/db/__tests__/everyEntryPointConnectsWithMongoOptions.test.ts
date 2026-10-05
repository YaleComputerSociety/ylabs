import fs from 'node:fs';
import path from 'node:path';

import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import ts from 'typescript';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  connectScriptMongo,
  createScriptMongoConnection,
  scriptMongoConnectOptions,
  type ScriptMongoConnectOptions,
} from '../connections';

const SERVER_SRC = path.resolve(__dirname, '../..');
const CONNECTIONS_MODULE = path.join(SERVER_SRC, 'db', 'connections.ts');
const MONGOOSE_CONNECT_MEMBERS = new Set(['connect', 'createConnection', 'openUri']);
const SCHEMA_MUTATING_SETTINGS = new Set(['autoIndex', 'autoCreate']);

const sourceFiles = (dir: string): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return entry.name === '__tests__' || entry.name === 'node_modules'
        ? []
        : sourceFiles(fullPath);
    }
    const isSource = entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts');
    const isTest = /\.(test|spec)\.ts$/.test(entry.name);
    return isSource && !isTest ? [fullPath] : [];
  });

const isMongooseSpecifier = (node: ts.Node): boolean =>
  ts.isStringLiteral(node) && node.text === 'mongoose';

function unguardedMongoConnectSites(fileName: string, text: string): string[] {
  const source = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true);
  const mongooseNames = new Set<string>();
  const sites: string[] = [];
  const at = (node: ts.Node, what: string) => {
    const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
    sites.push(`${fileName}:${line + 1} ${what}`);
  };

  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || !isMongooseSpecifier(statement.moduleSpecifier)) {
      continue;
    }
    const clause = statement.importClause;
    if (!clause || clause.isTypeOnly) continue;
    if (clause.name) mongooseNames.add(clause.name.text);
    const bindings = clause.namedBindings;
    if (bindings && ts.isNamespaceImport(bindings)) mongooseNames.add(bindings.name.text);
    if (bindings && ts.isNamedImports(bindings)) {
      for (const element of bindings.elements) {
        const imported = (element.propertyName ?? element.name).text;
        if (!element.isTypeOnly && MONGOOSE_CONNECT_MEMBERS.has(imported)) {
          at(element, `imports ${imported} from mongoose`);
        }
      }
    }
  }

  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node)) {
      if (
        node.expression.kind === ts.SyntaxKind.ImportKeyword &&
        node.arguments[0] &&
        isMongooseSpecifier(node.arguments[0])
      ) {
        at(node, 'imports mongoose dynamically');
      }
      const callee = node.expression;
      if (
        ts.isPropertyAccessExpression(callee) &&
        ts.isIdentifier(callee.expression) &&
        mongooseNames.has(callee.expression.text)
      ) {
        const member = callee.name.text;
        if (MONGOOSE_CONNECT_MEMBERS.has(member)) at(node, `calls mongoose.${member}`);
        const setting = node.arguments[0];
        if (
          member === 'set' &&
          setting &&
          ts.isStringLiteral(setting) &&
          SCHEMA_MUTATING_SETTINGS.has(setting.text)
        ) {
          at(node, `sets mongoose ${setting.text} globally`);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return sites;
}

describe('every entry point connects with mongoOptions (#3932)', () => {
  it('finds no Mongo connect outside db/connections.ts', () => {
    const sites = sourceFiles(SERVER_SRC)
      .filter((file) => file !== CONNECTIONS_MODULE)
      .flatMap((file) =>
        unguardedMongoConnectSites(path.relative(SERVER_SRC, file), fs.readFileSync(file, 'utf8')),
      );
    expect(sites).toEqual([]);
  });

  it('flags each shape of connect that bypasses the shared options', () => {
    const flagged = unguardedMongoConnectSites(
      'probe.ts',
      [
        "import mongoose, { createConnection as open } from 'mongoose';",
        "import * as driver from 'mongoose';",
        'await mongoose.connect(url);',
        'await mongoose.connect(url, { autoIndex: false, autoCreate: false });',
        'await driver.createConnection(url).asPromise();',
        "mongoose.set('autoIndex', false);",
        "const { default: lazy } = await import('mongoose');",
      ].join('\n'),
    );
    expect(flagged).toEqual([
      'probe.ts:1 imports createConnection from mongoose',
      'probe.ts:3 calls mongoose.connect',
      'probe.ts:4 calls mongoose.connect',
      'probe.ts:5 calls mongoose.createConnection',
      'probe.ts:6 sets mongoose autoIndex globally',
      'probe.ts:7 imports mongoose dynamically',
    ]);
  });

  it('leaves a type-only import, an unrelated socket and a non-schema setting alone', () => {
    const flagged = unguardedMongoConnectSites(
      'probe.ts',
      [
        "import type { Connection } from 'mongoose';",
        "import mongoose from 'mongoose';",
        "import net from 'node:net';",
        'net.createConnection(socketPath);',
        "mongoose.set('strictQuery', true);",
        'await mongoose.disconnect();',
      ].join('\n'),
    );
    expect(flagged).toEqual([]);
  });

  it('keeps both schema-mutating defaults off whatever a caller passes', () => {
    const smuggled = {
      autoIndex: true,
      autoCreate: true,
      maxPoolSize: 5,
    } as ScriptMongoConnectOptions;
    const options = scriptMongoConnectOptions(smuggled);
    expect(options.autoIndex).toBe(false);
    expect(options.autoCreate).toBe(false);
    expect(options.maxPoolSize).toBe(5);
  });
});

describe('a script connection does not create collections or indexes (#3932)', () => {
  let server: MongoMemoryServer;
  let uri: string;

  beforeAll(async () => {
    server = await MongoMemoryServer.create();
    uri = server.getUri();
  });

  afterAll(async () => {
    await server?.stop();
  });

  const probeSchema = (collection: string): mongoose.Schema => {
    const schema = new mongoose.Schema({ slug: String }, { collection });
    schema.index({ slug: 1 }, { unique: true });
    return schema;
  };

  const collectionNames = async (): Promise<string[]> => {
    const reader = await mongoose.createConnection(uri).asPromise();
    const names = (await reader.db!.listCollections({}, { nameOnly: true }).toArray()).map(
      (entry) => entry.name,
    );
    await reader.close();
    return names;
  };

  it('connectScriptMongo registers a model without creating its collection', async () => {
    await connectScriptMongo(uri);
    try {
      await mongoose.model('ScriptConnectProbe', probeSchema('script_connect_probe_rows')).init();
      expect(await collectionNames()).not.toContain('script_connect_probe_rows');
    } finally {
      await mongoose.disconnect();
    }
  });

  it('createScriptMongoConnection registers a model without creating its collection', async () => {
    const connection = await createScriptMongoConnection(uri);
    try {
      await connection
        .model('ScriptConnectionProbe', probeSchema('script_connection_probe_rows'))
        .init();
      expect(await collectionNames()).not.toContain('script_connection_probe_rows');
    } finally {
      await connection.close();
    }
  });
});
