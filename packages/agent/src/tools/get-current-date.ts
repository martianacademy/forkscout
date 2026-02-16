import { z } from 'zod';

/**
 * Get Current Date Tool
 * ----------------------
 * Returns the current date as a string in YYYY-MM-DD format.
 */
export const getCurrentDateTool = {
  name: 'get_current_date',
  description: 'Returns the current date in YYYY-MM-DD format',
  parameters: z.object({}),
  async execute(): Promise<string> {
    const now = new Date();
    return now.toISOString().split('T')[0];
  },
};
