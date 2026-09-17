import { z } from "zod";
import { userRoleSchema } from "./auth";

export const userStatusSchema = z.enum(["active", "disabled"]);

export const userCreateRequestSchema = z.object({
  email: z.string().trim().email(),
  displayName: z.string().trim().min(1).max(120),
  role: userRoleSchema,
});

export const userUpdateRequestSchema = z.object({
  role: userRoleSchema.optional(),
  status: userStatusSchema.optional(),
}).refine((value) => value.role !== undefined || value.status !== undefined, { message: "at_least_one_change_required" });

export const userResetPasswordRequestSchema = z.object({});

export type UserCreateRequest = z.infer<typeof userCreateRequestSchema>;
export type UserUpdateRequest = z.infer<typeof userUpdateRequestSchema>;
export type UserStatus = z.infer<typeof userStatusSchema>;
