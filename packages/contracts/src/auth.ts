import { z } from "zod";

export const userRoleSchema = z.enum(["admin", "operator"]);

export const userSummarySchema = z.object({
  email: z.string().email(),
  displayName: z.string().min(1),
  role: userRoleSchema,
  mustChangePassword: z.boolean(),
});

export const loginRequestSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(1),
});

export const loginResponseSchema = z.object({
  user: userSummarySchema,
});

export const csrfResponseSchema = z.object({
  csrfToken: z.string().min(1),
});

export const changePasswordRequestSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(12),
});

export const reauthenticateRequestSchema = z.object({
  password: z.string().min(1),
});

export type UserRole = z.infer<typeof userRoleSchema>;
export type UserSummary = z.infer<typeof userSummarySchema>;
export type LoginRequest = z.infer<typeof loginRequestSchema>;
