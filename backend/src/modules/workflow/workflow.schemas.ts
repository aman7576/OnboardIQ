import { z } from 'zod';

// Spec section 3: an officer recommendation needs a comment of at least 10 characters.
export const recommendationBody = z.strictObject({
  recommendation: z.enum(['APPROVE', 'REJECT', 'REQUEST_RESUBMISSION'], {
    error: 'must be APPROVE, REJECT or REQUEST_RESUBMISSION',
  }),
  comment: z.string().trim().min(10, 'must be at least 10 characters').max(2000),
});

// ASSUMPTION: the spec asks for "a comment" from the checker without a minimum length; it must not be empty.
export const checkerBody = z.strictObject({
  action: z.enum(['APPROVE', 'REJECT', 'SEND_BACK'], {
    error: 'must be APPROVE, REJECT or SEND_BACK',
  }),
  comment: z.string().trim().min(1, 'is required').max(2000),
});

export type RecommendationBody = z.infer<typeof recommendationBody>;
export type CheckerBody = z.infer<typeof checkerBody>;
