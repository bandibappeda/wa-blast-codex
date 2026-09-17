import { dashboardResponseSchema, type DashboardResponse } from "@wa-blast/contracts";
import type { Database } from "bun:sqlite";
import type { Clock } from "../../shared/clock";

interface DashboardDependencies {
  db: Database;
  clock: Clock;
}

export class DashboardService {
  constructor(private readonly dependencies: DashboardDependencies) {}

  getOverview(organizationId: string): DashboardResponse {
    const queue = this.queueMetrics(organizationId);
    const approvals = this.dependencies.db.query<{ pending: number }, [string]>(
      "SELECT COUNT(*) AS pending FROM campaigns WHERE organization_id = ? AND state = 'pending_approval'",
    ).get(organizationId)?.pending ?? 0;
    const activeCampaigns = this.activeCampaigns(organizationId);
    const gateways = this.gatewayMetrics(organizationId);
    const delivery = this.deliveryMetrics(organizationId);
    const recentFailures = this.recentFailures(organizationId);

    return dashboardResponseSchema.parse({
      queue: {
        depth: queue.depth,
        oldestPendingAt: queue.oldestPendingAt,
        oldestPendingAgeSeconds: queue.oldestPendingAt ? Math.max(0, Math.floor((this.dependencies.clock.now().getTime() - new Date(queue.oldestPendingAt).getTime()) / 1000)) : null,
      },
      approvals: { pending: approvals },
      activeCampaigns,
      gateways,
      delivery,
      recentFailures,
    });
  }

  private queueMetrics(organizationId: string): { depth: number; oldestPendingAt: string | null } {
    const row = this.dependencies.db.query<{ depth: number; oldest_pending_at: string | null }, [string]>(
      `SELECT COUNT(*) AS depth, MIN(j.available_at) AS oldest_pending_at
       FROM message_jobs j
       JOIN campaigns c ON c.id = j.campaign_id
       WHERE c.organization_id = ? AND j.status IN ('pending', 'retry')`,
    ).get(organizationId);
    return { depth: row?.depth ?? 0, oldestPendingAt: row?.oldest_pending_at ?? null };
  }

  private activeCampaigns(organizationId: string): DashboardResponse["activeCampaigns"] {
    const rows = this.dependencies.db.query<{
      id: string;
      name: string;
      state: string;
      total: number;
      pending: number;
      sent: number;
      delivered: number;
      read: number;
      failed: number;
    }, [string]>(
      `SELECT c.id, c.name, c.state,
              COUNT(j.id) AS total,
              COALESCE(SUM(CASE WHEN j.status IN ('pending', 'retry', 'leased') THEN 1 ELSE 0 END), 0) AS pending,
              COALESCE(SUM(CASE WHEN j.status = 'sent' THEN 1 ELSE 0 END), 0) AS sent,
              COALESCE(SUM(CASE WHEN j.status = 'delivered' THEN 1 ELSE 0 END), 0) AS delivered,
              COALESCE(SUM(CASE WHEN j.status = 'read' THEN 1 ELSE 0 END), 0) AS read,
              COALESCE(SUM(CASE WHEN j.status = 'failed' THEN 1 ELSE 0 END), 0) AS failed
       FROM campaigns c
       LEFT JOIN message_jobs j ON j.campaign_id = c.id
       WHERE c.organization_id = ? AND c.state IN ('scheduled', 'queued', 'running')
       GROUP BY c.id
       ORDER BY c.updated_at DESC, c.id DESC
       LIMIT 10`,
    ).all(organizationId);
    return rows.map((row) => ({
      ...row,
      progressPercent: row.total === 0 ? 0 : Math.round(((row.total - row.pending) / row.total) * 100),
    }));
  }

  private gatewayMetrics(organizationId: string): DashboardResponse["gateways"] {
    const rows = this.dependencies.db.query<{ health_status: "healthy" | "unhealthy" | "unknown"; count: number }, [string]>(
      "SELECT health_status, COUNT(*) AS count FROM gateway_connections WHERE organization_id = ? GROUP BY health_status",
    ).all(organizationId);
    const result = { total: 0, healthy: 0, unhealthy: 0, unknown: 0 };
    for (const row of rows) {
      result.total += row.count;
      result[row.health_status] = row.count;
    }
    return result;
  }

  private deliveryMetrics(organizationId: string): DashboardResponse["delivery"] {
    const row = this.dependencies.db.query<{
      total: number;
      pending: number;
      retrying: number;
      sent: number;
      delivered: number;
      read: number;
      failed: number;
    }, [string]>(
      `SELECT COUNT(j.id) AS total,
              COALESCE(SUM(CASE WHEN j.status = 'pending' THEN 1 ELSE 0 END), 0) AS pending,
              COALESCE(SUM(CASE WHEN j.status = 'retry' THEN 1 ELSE 0 END), 0) AS retrying,
              COALESCE(SUM(CASE WHEN j.status = 'sent' THEN 1 ELSE 0 END), 0) AS sent,
              COALESCE(SUM(CASE WHEN j.status = 'delivered' THEN 1 ELSE 0 END), 0) AS delivered,
              COALESCE(SUM(CASE WHEN j.status = 'read' THEN 1 ELSE 0 END), 0) AS read,
              COALESCE(SUM(CASE WHEN j.status = 'failed' THEN 1 ELSE 0 END), 0) AS failed
       FROM message_jobs j
       JOIN campaigns c ON c.id = j.campaign_id
       WHERE c.organization_id = ?`,
    ).get(organizationId) ?? { total: 0, pending: 0, retrying: 0, sent: 0, delivered: 0, read: 0, failed: 0 };
    const successful = row.sent + row.delivered + row.read;
    return { ...row, successRate: row.total === 0 ? null : Math.round((successful / row.total) * 1000) / 10 };
  }

  private recentFailures(organizationId: string): DashboardResponse["recentFailures"] {
    return this.dependencies.db.query<{
      job_id: string;
      campaign_id: string;
      campaign_name: string;
      recipient_name: string;
      message: string | null;
      updated_at: string;
    }, [string]>(
      `SELECT j.id AS job_id, c.id AS campaign_id, c.name AS campaign_name,
              cr.name AS recipient_name, j.last_error_message AS message, j.updated_at
       FROM message_jobs j
       JOIN campaigns c ON c.id = j.campaign_id
       JOIN campaign_recipients cr ON cr.id = j.campaign_recipient_id
       WHERE c.organization_id = ? AND j.status = 'failed'
       ORDER BY j.updated_at DESC, j.id DESC
       LIMIT 8`,
    ).all(organizationId).map((row) => ({
      jobId: row.job_id,
      campaignId: row.campaign_id,
      campaignName: row.campaign_name,
      recipientName: row.recipient_name,
      message: row.message ?? "Delivery failed",
      updatedAt: row.updated_at,
    }));
  }
}
