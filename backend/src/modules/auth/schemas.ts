import { z } from 'zod';

const email = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email('must be a valid e-mail address'))
  .pipe(z.string().max(254));

// strictObject: unknown keys (for example a "role" field) are rejected, never silently accepted.
export const registerBody = z.strictObject({
  email,
  password: z
    .string()
    .min(12, 'must be at least 12 characters')
    .max(128, 'must be at most 128 characters'),
  display_name: z.string().trim().min(2, 'must be at least 2 characters').max(80),
});

// Bank staff sign-up: the bank's enrollment code proves the person was invited. Only staff roles can be chosen.
export const staffRegisterBody = z.strictObject({
  email,
  password: z
    .string()
    .min(12, 'must be at least 12 characters')
    .max(128, 'must be at most 128 characters'),
  display_name: z.string().trim().min(2, 'must be at least 2 characters').max(80),
  role: z.enum(['KYC_OFFICER', 'COMPLIANCE_OFFICER']),
  enrollment_code: z.string().min(1, 'is required').max(128),
});

export const loginBody = z.strictObject({
  email: z.string().trim().toLowerCase().min(1, 'is required').max(254),
  password: z.string().min(1, 'is required').max(128),
});

export type RegisterBody = z.infer<typeof registerBody>;
export type StaffRegisterBody = z.infer<typeof staffRegisterBody>;
export type LoginBody = z.infer<typeof loginBody>;
