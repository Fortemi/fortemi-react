import Ajv2020 from 'ajv/dist/2020.js'
import type { ErrorObject, ValidateFunction } from 'ajv'
import schema from '../schemas/aiwg-fortemi-index-export.schema.json' with { type: 'json' }

export interface AiwgIndexSchemaValidationResult {
  valid: boolean
  errors: string[]
}

const PROJECTED_FIELDS = [
  'schema_version',
  'id',
  'type',
  'title',
  'text',
  'facets',
  'tags',
  'concepts',
  'privacy',
] as const

let ajvInstance: Ajv2020 | undefined
let exportValidator: ValidateFunction | undefined
let projectedRecordValidator: ValidateFunction | undefined

export function getAiwgFortemiIndexExportSchema(): unknown {
  return schema
}

function getAjv(): Ajv2020 {
  if (!ajvInstance) {
    ajvInstance = new Ajv2020({
      allErrors: true,
      strict: false,
      validateFormats: false,
    })
    ajvInstance.addSchema(schema)
  }
  return ajvInstance
}

function formatErrors(errors: ErrorObject[] | null | undefined): string[] {
  return (errors ?? []).map((error) => {
    const path = error.instancePath || '(root)'
    return `${path} ${error.message ?? 'is invalid'}`
  })
}

function getExportValidator(): ValidateFunction {
  exportValidator ??= getAjv().getSchema(schema.$id) ?? getAjv().compile(schema)
  return exportValidator
}

function getProjectedRecordValidator(): ValidateFunction {
  if (!projectedRecordValidator) {
    const properties = Object.fromEntries(Object.keys(schema.$defs.record.properties).map((field) => [
      field,
      { $ref: `${schema.$id}#/$defs/record/properties/${field}` },
    ]))
    projectedRecordValidator = getAjv().compile({
      type: 'object',
      required: PROJECTED_FIELDS,
      properties,
      additionalProperties: true,
      allOf: [
        {
          if: {
            properties: {
              schema_version: { const: 'aiwg.fortemi.index.record.v1' },
            },
          },
          then: { $ref: `${schema.$id}#/$defs/v1RecordCompatibility` },
        },
      ],
    })
  }
  return projectedRecordValidator
}

export function validateAiwgFortemiIndexExportSchema(value: unknown): AiwgIndexSchemaValidationResult {
  const validate = getExportValidator()
  // `binary_sources` is a documented fortemi-react attachment-text extension;
  // upstream intentionally omits it. Validate every upstream field against the
  // pinned authority while keeping that local extension out of the schema input.
  const schemaValue = value && typeof value === 'object' && Array.isArray((value as { items?: unknown }).items)
    ? {
        ...(value as Record<string, unknown>),
        items: (value as { items: unknown[] }).items.map((item) => {
          if (!item || typeof item !== 'object' || Array.isArray(item)) return item
          const schemaRecord = { ...(item as Record<string, unknown>) }
          Reflect.deleteProperty(schemaRecord, 'binary_sources')
          return schemaRecord
        }),
      }
    : value
  const valid = validate(schemaValue)
  return { valid, errors: formatErrors(validate.errors) }
}

export function validateAiwgFortemiProjectedRecordSchema(value: unknown): AiwgIndexSchemaValidationResult {
  const validate = getProjectedRecordValidator()
  const valid = validate(value)
  return { valid, errors: formatErrors(validate.errors) }
}
