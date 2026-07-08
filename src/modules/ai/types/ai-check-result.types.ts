export type AiVerdict = 'pass' | 'warn' | 'fail';

export interface AiCheckDetail {
  verdict: AiVerdict;
  notes: string;
}

export interface AiProductCheckResult {
  verdict: AiVerdict;
  checks: {
    description: AiCheckDetail;
    dataConsistency: AiCheckDetail;
    photos: AiCheckDetail;
    photoMatch: AiCheckDetail;
  };
  summary: string;
}

/** JSON-схема для response_format: json_schema (structured outputs). */
export const AI_PRODUCT_CHECK_JSON_SCHEMA = {
  name: 'product_check_result',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      verdict: { type: 'string', enum: ['pass', 'warn', 'fail'] },
      checks: {
        type: 'object',
        additionalProperties: false,
        properties: {
          description: {
            type: 'object',
            additionalProperties: false,
            properties: {
              verdict: { type: 'string', enum: ['pass', 'warn', 'fail'] },
              notes: { type: 'string' },
            },
            required: ['verdict', 'notes'],
          },
          dataConsistency: {
            type: 'object',
            additionalProperties: false,
            properties: {
              verdict: { type: 'string', enum: ['pass', 'warn', 'fail'] },
              notes: { type: 'string' },
            },
            required: ['verdict', 'notes'],
          },
          photos: {
            type: 'object',
            additionalProperties: false,
            properties: {
              verdict: { type: 'string', enum: ['pass', 'warn', 'fail'] },
              notes: { type: 'string' },
            },
            required: ['verdict', 'notes'],
          },
          photoMatch: {
            type: 'object',
            additionalProperties: false,
            properties: {
              verdict: { type: 'string', enum: ['pass', 'warn', 'fail'] },
              notes: { type: 'string' },
            },
            required: ['verdict', 'notes'],
          },
        },
        required: ['description', 'dataConsistency', 'photos', 'photoMatch'],
      },
      summary: { type: 'string' },
    },
    required: ['verdict', 'checks', 'summary'],
  },
} as const;
