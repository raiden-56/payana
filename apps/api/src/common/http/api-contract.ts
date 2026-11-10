import { applyDecorators } from '@nestjs/common';
import { ApiBody, ApiOperation, ApiResponse } from '@nestjs/swagger';

export interface ApiContractOptions {
  summary: string;
  /** Name of the request body type in @payana/contracts. */
  body?: string;
  /** Name of the response type in @payana/contracts. Omit for 204 responses. */
  response?: string;
  /** Response is `Paginated<response>`. */
  paginated?: boolean;
  /** Response is an array of `response`. */
  array?: boolean;
  /** Response may be null. */
  nullable?: boolean;
  /** Success status. Default 200 (204 when there is no response type). */
  status?: number;
  /** Route requires an Idempotency-Key header. */
  idempotent?: boolean;
}

const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });

/**
 * Documents a route against the shared contract types. The schemas
 * themselves are generated from packages/contracts by `npm run openapi:export`
 * and injected under components.schemas, so the OpenAPI document cannot drift
 * from the types the clients compile against.
 */
export function ApiContract(o: ApiContractOptions): MethodDecorator {
  const decorators: MethodDecorator[] = [
    ApiOperation({
      summary: o.summary,
      description: o.idempotent ? 'Requires an `Idempotency-Key` header.' : undefined,
    }),
  ];
  if (o.body) decorators.push(ApiBody({ schema: ref(o.body) }));
  if (o.response) {
    let schema: Record<string, unknown> = ref(o.response);
    if (o.array) schema = { type: 'array', items: schema };
    if (o.paginated) {
      schema = {
        type: 'object',
        required: ['items', 'page', 'pageSize', 'total'],
        properties: {
          items: { type: 'array', items: ref(o.response) },
          page: { type: 'integer' },
          pageSize: { type: 'integer' },
          total: { type: 'integer' },
        },
      };
    }
    if (o.nullable) schema = { oneOf: [schema, { type: 'null' }] };
    decorators.push(ApiResponse({ status: o.status ?? 200, schema }));
  } else {
    decorators.push(ApiResponse({ status: o.status ?? 204, description: 'No content' }));
  }
  decorators.push(
    ApiResponse({
      status: '4XX',
      description: 'Problem details (application/problem+json)',
      content: { 'application/problem+json': { schema: ref('ProblemDetails') } },
    }),
  );
  return applyDecorators(...decorators);
}
