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
  campaignCreateRequestSchema,
  campaignSubmitRequestSchema,
  campaignUpdateRequestSchema,
  type CampaignCreateRequest,
  type CampaignUpdateRequest,
} from "./campaigns";
