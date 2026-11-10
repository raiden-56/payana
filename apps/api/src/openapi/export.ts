/**
 * Writes specs/api/openapi.yaml.   npm run openapi:export
 *
 * Paths, parameters and security come from the running application (so a
 * route that exists is a route that is documented). Request and response
 * schemas come from the shared contract package: every exported type in
 * packages/contracts is converted to JSON Schema and placed under
 * components.schemas, and each operation refers to its types by name.
 *
 * The output is deterministic - map keys are sorted and nothing time- or
 * machine-dependent is written - so the file only changes when the API does.
 * Needs the local Postgres and Redis (the application has to boot).
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { NestFactory } from '@nestjs/core';
import { stringify } from 'yaml';
import { AppModule } from '../app.module.js';
import { buildOpenApiDocument, configureApp } from '../bootstrap.js';
import { APP_CONFIG, type AppConfig } from '../config/env.js';

const REPO_ROOT = resolve(process.cwd(), '..', '..');
const CONTRACTS_ENTRY = resolve(REPO_ROOT, 'packages/contracts/src/index.ts');
const CONTRACTS_TSCONFIG = resolve(REPO_ROOT, 'packages/contracts/tsconfig.esm.json');
const OUTPUT = resolve(REPO_ROOT, 'specs/api/openapi.yaml');

function rewriteRefs(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(rewriteRefs);
  if (node && typeof node === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(node)) {
      out[k] = k === '$ref' && typeof v === 'string' ? v.replace('#/definitions/', '#/components/schemas/') : rewriteRefs(v);
    }
    return out;
  }
  return node;
}

async function contractSchemas(): Promise<Record<string, unknown>> {
  // Loaded on demand: the generator is a development dependency and is not in the production image.
  const { createGenerator } = await import('ts-json-schema-generator');
  const schema = createGenerator({
    path: CONTRACTS_ENTRY,
    tsconfig: CONTRACTS_TSCONFIG,
    type: '*',
    expose: 'export',
    skipTypeCheck: true,
    additionalProperties: false,
  }).createSchema('*');
  const out: Record<string, unknown> = {};
  for (const [name, definition] of Object.entries(schema.definitions ?? {})) {
    // Generic helpers such as Paginated<T> are expanded inline where they are used.
    if (/[<>]/.test(name)) continue;
    out[name] = rewriteRefs(definition);
  }
  return out;
}

async function main(): Promise<void> {
  const app = await NestFactory.create(AppModule, { logger: ['error'] });
  try {
    const config = app.get<AppConfig>(APP_CONFIG);
    configureApp(app, config);
    await app.init();
    const doc = buildOpenApiDocument(app, { ...config, appName: 'Payana' }) as unknown as Record<string, unknown> & {
      components?: { schemas?: Record<string, unknown> };
    };
    // JSON Schema keywords used by the contract schemas (const, type unions with null) need OpenAPI 3.1.
    doc.openapi = '3.1.0';
    doc.servers = [{ url: '/', description: 'Same origin as the web client (all paths start with /api/v1)' }];
    doc.components = { ...doc.components, schemas: { ...doc.components?.schemas, ...(await contractSchemas()) } };

    const yaml = stringify(doc, { sortMapEntries: true, lineWidth: 120 });
    const header =
      '# GENERATED FILE - do not edit by hand.\n' +
      '# Source: the NestJS application (paths) and packages/contracts (schemas).\n' +
      '# Regenerate with `npm run openapi:export` in apps/api.\n';
    await mkdir(dirname(OUTPUT), { recursive: true });
    await writeFile(OUTPUT, header + yaml, 'utf8');
    const paths = Object.keys((doc.paths as object) ?? {}).length;
    console.log(`Wrote ${OUTPUT} (${paths} paths, ${Object.keys(doc.components.schemas ?? {}).length} schemas)`);
  } finally {
    await app.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
