/**
 * MCP schema conversion — JSON Schema → Zod.
 *
 * Converts MCP tool input schemas (JSON Schema format) into
 * Zod schemas that the AI SDK tool system expects. Handles
 * common types; falls back to z.any() for complex schemas.
 *
 * @module mcp/schema
 */

import { z } from 'zod';

/**
 * Convert a JSON Schema (from MCP) into a Zod object schema.
 * Handles string, number, integer, boolean, array, and object types.
 */
export function jsonSchemaToZod(schema?: any): z.ZodObject<any> {
    if (!schema || !schema.properties) {
        return z.object({});
    }

    const shape: Record<string, z.ZodTypeAny> = {};
    const required = new Set(schema.required || []);

    for (const [key, prop] of Object.entries(schema.properties as Record<string, any>)) {
        let field: z.ZodTypeAny;

        switch (prop.type) {
            case 'string':
                field = z.string();
                if (prop.enum) field = z.enum(prop.enum);
                break;
            case 'number':
            case 'integer':
                field = z.number();
                break;
            case 'boolean':
                field = z.boolean();
                break;
            case 'array':
                field = z.array(jsonSchemaTypeToZod(prop.items));
                break;
            case 'object':
                if (prop.properties) {
                    field = jsonSchemaToZod(prop);
                } else {
                    field = z.record(z.any());
                }
                break;
            default:
                field = z.any();
        }

        if (prop.description) {
            field = field.describe(prop.description);
        }

        if (!required.has(key)) {
            field = field.optional();
        }

        shape[key] = field;
    }

    return z.object(shape);
}

/**
 * Convert a single JSON Schema type to a Zod type (for array items, etc.).
 */
export function jsonSchemaTypeToZod(schema?: any): z.ZodTypeAny {
    if (!schema) return z.any();

    switch (schema.type) {
        case 'string': return z.string();
        case 'number':
        case 'integer': return z.number();
        case 'boolean': return z.boolean();
        case 'object': return schema.properties ? jsonSchemaToZod(schema) : z.record(z.any());
        case 'array': return z.array(jsonSchemaTypeToZod(schema.items));
        default: return z.any();
    }
}
