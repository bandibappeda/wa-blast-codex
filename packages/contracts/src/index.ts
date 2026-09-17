export {
  healthResponseSchema,
  type HealthResponse,
} from "./health";

export {
  changePasswordRequestSchema,
  csrfResponseSchema,
  loginRequestSchema,
  loginResponseSchema,
  reauthenticateRequestSchema,
  userRoleSchema,
  userSummarySchema,
  type LoginRequest,
  type UserRole,
  type UserSummary,
} from "./auth";

export {
  contactCreateRequestSchema,
  contactImportPreviewRequestSchema,
  suppressionRequestSchema,
  type ContactCreateRequest,
  type ContactImportPreviewRequest,
} from "./contacts";

export {
  gatewayCreateRequestSchema,
  gatewayTestMessageRequestSchema,
  gatewayUpdateRequestSchema,
  type GatewayCreateRequest,
  type GatewayUpdateRequest,
} from "./gateways";

export {
  templateBodySchema,
  templateCreateRequestSchema,
  templatePreviewRequestSchema,
  templateUpdateRequestSchema,
  type TemplateCreateRequest,
  type TemplateUpdateRequest,
} from "./templates";

export {
  campaignApprovalRequestSchema,
  campaignCreateRequestSchema,
  campaignSubmitRequestSchema,
  campaignUpdateRequestSchema,
  type CampaignCreateRequest,
  type CampaignUpdateRequest,
} from "./campaigns";

export {
  deliveryResultStatusSchema,
  deliveryResultsQuerySchema,
  gatewayWebhookRequestSchema,
  type GatewayWebhookRequest,
  type DeliveryResultsQuery,
} from "./delivery";

export {
  dashboardResponseSchema,
  type DashboardResponse,
} from "./dashboard";

export {
  userCreateRequestSchema,
  userResetPasswordRequestSchema,
  userStatusSchema,
  userUpdateRequestSchema,
  type UserCreateRequest,
  type UserStatus,
  type UserUpdateRequest,
} from "./users";

export {
  auditQuerySchema,
  type AuditQuery,
} from "./audit";
