import {
  Injectable,
  BadRequestException,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { Prisma } from '@prisma/client';
import { AuthActor, authActor } from '../../common/auth-identity';
import { CurrentUserPayload } from '../../common/decorators/current-user.decorator';

export interface ModerationCheckResult {
  isApproved: boolean;
  suggestedStatus: 'APPROVED' | 'PENDING' | 'SPAM';
  flags: string[];
  riskScore: number;
  reason?: string;
  sanitizedComment: string;
}

interface RateLimitRecord {
  timestamps: number[];
}

@Injectable()
export class ContentModerationService {
  constructor(private readonly prisma: PrismaService) {}

  // In-memory rate limiting stores
  private customerReviewTimestamps = new Map<number, RateLimitRecord>();
  private customerReportTimestamps = new Map<number, RateLimitRecord>();

  // Layer 3: Rule-Based Keywords (Vietnamese & English)
  private readonly BLOCKED_KEYWORDS = [
    // Profanity / Abuse
    'đụ',
    'địt',
    'đéo',
    'lồn',
    'buồi',
    'cặc',
    'đm',
    'dcm',
    'vcl',
    'đmm',
    'vl',
    'chó chết',
    'fuck',
    'shit',
    'bitch',
    'asshole',
    // Gambling / Scam / Phishing
    'nhà cái',
    'cá độ',
    'tài xỉu',
    'casino',
    'nạp tiền',
    'kubet',
    'thabet',
    'shbet',
    'lừa đảo',
    'đa cấp',
    'nhận quà miễn phí',
    'bấm vào link',
    // Illegal / Black market pharma
    'ma túy',
    'thuốc lắc',
    'cần sa',
    'kẹo ke',
    'hàng trắng',
    'hàng cấm',
    'chữa bách bệnh',
    'khỏi ung thư 100%',
    'thần dược không cần khám',
    // Contact spam / Social phishing
    't.me/',
    'telegram:',
    'zalo:',
    'inbox zalo',
    'liên hệ sđt',
    'add zalo',
    'gọi ngay hotline',
  ];

  // ================= LAYER 1: SANITIZATION =================

  /**
   * Sanitizes user input: strips HTML, strips script tags, trims excess whitespace
   */
  sanitizeText(input: string): string {
    if (!input) return '';
    return input
      // Remove script tags and contents
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
      // Remove any HTML tags
      .replace(/<[^>]+>/g, '')
      // Remove null bytes and non-printable control characters
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
      // Normalize multiple whitespace to single space, except single newlines
      .replace(/[ \t]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  // ================= LAYER 2: RATE LIMITING =================

  /**
   * Check rate limits for submitting or editing reviews
   * Policy: Max 3 reviews per hour, max 5 in 24 hours
   */
  checkReviewRateLimit(customerId: number): void {
    const now = Date.now();
    const oneHour = 60 * 60 * 1000;
    const oneDay = 24 * 60 * 60 * 1000;

    let record = this.customerReviewTimestamps.get(customerId);
    if (!record) {
      record = { timestamps: [] };
      this.customerReviewTimestamps.set(customerId, record);
    }

    // Keep only timestamps within last 24 hours
    record.timestamps = record.timestamps.filter((ts) => now - ts < oneDay);

    const pastHourCount = record.timestamps.filter((ts) => now - ts < oneHour).length;
    if (pastHourCount >= 3) {
      throw new HttpException(
        'You have submitted too many reviews recently. Please wait an hour before submitting another.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    if (record.timestamps.length >= 8) {
      throw new HttpException(
        'Daily review limit reached. Please try again tomorrow.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    record.timestamps.push(now);
  }

  /**
   * Check rate limits for reporting reviews
   * Policy: Max 5 reports per day per customer
   */
  checkReportRateLimit(customerId: number): void {
    const now = Date.now();
    const oneDay = 24 * 60 * 60 * 1000;

    let record = this.customerReportTimestamps.get(customerId);
    if (!record) {
      record = { timestamps: [] };
      this.customerReportTimestamps.set(customerId, record);
    }

    record.timestamps = record.timestamps.filter((ts) => now - ts < oneDay);
    if (record.timestamps.length >= 5) {
      throw new HttpException(
        'You have reached the maximum number of reports for today. Please try again tomorrow.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    record.timestamps.push(now);
  }

  // ================= LAYER 3: RULE-BASED MODERATION =================

  /**
   * Evaluates text against deterministic anti-spam and content safety rules
   */
  checkRules(text: string): {
    hasViolation: boolean;
    flags: string[];
    riskScore: number;
    suggestedStatus: 'APPROVED' | 'PENDING' | 'SPAM';
  } {
    const flags: string[] = [];
    let riskScore = 0;
    const lower = text.toLowerCase();

    // 1. Blocked keyword check
    for (const kw of this.BLOCKED_KEYWORDS) {
      if (lower.includes(kw)) {
        flags.push(`Prohibited keyword matched: "${kw}"`);
        riskScore += 0.8;
      }
    }

    // 2. Suspicious URL / Link injection
    const urlPattern = /(https?:\/\/[^\s]+|www\.[^\s]+|[a-zA-Z0-9-]+\.(com|net|org|vn|xyz|top|info|cc)\b)/gi;
    const urlMatches = text.match(urlPattern);
    if (urlMatches && urlMatches.length > 0) {
      flags.push(`Suspicious external URL/link detected: ${urlMatches.slice(0, 2).join(', ')}`);
      riskScore += 0.5;
    }

    // 3. Repeated character spam (e.g. aaaaaaaa, !!!!!!!!, ????)
    const repeatedCharPattern = /(.)\1{6,}/;
    if (repeatedCharPattern.test(text)) {
      flags.push('Excessive character repetition detected');
      riskScore += 0.25;
    }

    // 4. Excessive UPPERCASE letters (e.g. SHOUTING SPAM)
    const lettersOnly = text.replace(/[^a-zA-ZÀ-ỹ]/g, '');
    if (lettersOnly.length > 15) {
      const upperCount = (text.match(/[A-ZÀ-Ỹ]/g) || []).length;
      const upperRatio = upperCount / lettersOnly.length;
      if (upperRatio > 0.65) {
        flags.push(`Excessive capitalization (${Math.round(upperRatio * 100)}% uppercase)`);
        riskScore += 0.2;
      }
    }

    // 5. Emoji spam (> 8 emojis)
    const emojiRegex = /[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu;
    const emojiCount = (text.match(emojiRegex) || []).length;
    if (emojiCount > 8) {
      flags.push(`Excessive emoji usage (${emojiCount} emojis)`);
      riskScore += 0.2;
    }

    let suggestedStatus: 'APPROVED' | 'PENDING' | 'SPAM' = 'APPROVED';
    if (riskScore >= 0.8) {
      suggestedStatus = 'SPAM';
    } else if (riskScore >= 0.35) {
      suggestedStatus = 'PENDING';
    }

    return {
      hasViolation: flags.length > 0,
      flags,
      riskScore: Math.min(1.0, riskScore),
      suggestedStatus,
    };
  }

  // ================= LAYER 4: AI CONTENT MODERATION (STUB) =================

  /**
   * Pluggable AI content moderation engine.
   * Currently uses deterministic linguistic heuristics (token diversity, medical claim patterns)
   * and can be seamlessly upgraded to an LLM API (e.g. Gemini / OpenAI) in the future.
   */
  async checkAi(text: string): Promise<{
    riskScore: number;
    label: 'safe' | 'suspicious' | 'harmful';
    reason: string;
  }> {
    const tokens = text
      .toLowerCase()
      .split(/\s+/)
      .filter((t) => t.length > 1);

    if (tokens.length === 0) {
      return { riskScore: 0, label: 'safe', reason: 'Empty or trivial text' };
    }

    // Token diversity / Lexical entropy check
    const uniqueTokens = new Set(tokens);
    const diversityRatio = uniqueTokens.size / tokens.length;

    let aiRisk = 0;
    const reasons: string[] = [];

    // Very low diversity on long text suggests bot/copy-paste spam
    if (tokens.length > 15 && diversityRatio < 0.35) {
      aiRisk += 0.4;
      reasons.push('Low lexical diversity (repetitive phrase patterns)');
    }

    // High-risk pharmaceutical medical claims
    const dangerousMedicalClaims = [
      'khỏi hẳn ung thư',
      'thần dược',
      'cam kết 100%',
      'uống là khỏi vĩnh viễn',
      'thay thế hoàn toàn phẫu thuật',
      'chết người',
      'ngộ độc tập thể',
    ];

    for (const claim of dangerousMedicalClaims) {
      if (text.toLowerCase().includes(claim)) {
        aiRisk += 0.5;
        reasons.push(`High-risk unverified medical claim: "${claim}"`);
      }
    }

    const finalScore = Math.min(1.0, aiRisk);
    let label: 'safe' | 'suspicious' | 'harmful' = 'safe';
    if (finalScore >= 0.7) label = 'harmful';
    else if (finalScore >= 0.35) label = 'suspicious';

    return {
      riskScore: finalScore,
      label,
      reason: reasons.length > 0 ? reasons.join('; ') : 'Content analyzed within normal parameters',
    };
  }

  // ================= COMPREHENSIVE MODERATION PIPELINE =================

  /**
   * Executes Layer 1 (Sanitization), Layer 3 (Rules), and Layer 4 (AI Stub)
   */
  async evaluateReview(comment: string): Promise<ModerationCheckResult> {
    const sanitized = this.sanitizeText(comment);

    if (!sanitized) {
      throw new BadRequestException('Review comment cannot be empty after sanitization.');
    }

    const ruleResult = this.checkRules(sanitized);
    const aiResult = await this.checkAi(sanitized);

    const combinedFlags = [...ruleResult.flags];
    if (aiResult.label !== 'safe') {
      combinedFlags.push(`[AI Signal] ${aiResult.reason}`);
    }

    const combinedRisk = Math.min(1.0, Math.max(ruleResult.riskScore, aiResult.riskScore));

    let suggestedStatus: 'APPROVED' | 'PENDING' | 'SPAM' = 'APPROVED';
    if (ruleResult.suggestedStatus === 'SPAM' || aiResult.label === 'harmful') {
      suggestedStatus = 'SPAM';
    } else if (ruleResult.suggestedStatus === 'PENDING' || aiResult.label === 'suspicious') {
      suggestedStatus = 'PENDING';
    }

    return {
      isApproved: suggestedStatus === 'APPROVED',
      suggestedStatus,
      flags: combinedFlags,
      riskScore: combinedRisk,
      reason: combinedFlags.join(' | ') || undefined,
      sanitizedComment: sanitized,
    };
  }

  // ================= LAYER 5 & 6: AUDIT LOGGING =================

  /**
   * Logs moderation action to moderation_audit_logs table
   */
  async logAudit(params: {
    reviewId?: number;
    action: string;
    employeeId?: number;
    customerId?: number;
    role?: string;
    reason?: string;
    meta?: any;
  }, tx: Prisma.TransactionClient) {
    const meta = { ...(params.meta || {}), ...(params.reviewId ? { reviewId: params.reviewId } : {}) };
    await tx.$executeRaw`
      INSERT INTO public.moderation_audit_logs
        (review_id, action, performed_by_employee_id, performed_by_customer_id, performed_by_role, reason, meta)
      VALUES (${params.reviewId || null}, ${params.action}, ${params.employeeId || null},
        ${params.customerId || null}, ${params.role || null}, ${params.reason || null}, ${JSON.stringify(meta)}::jsonb)
    `;
  }

  // ================= LAYER 6: REPORTING OPERATIONS =================

  /**
   * Customer reports an inappropriate or spam review
   */
  async reportReview(
    reviewId: number,
    identity: AuthActor,
    reason: string,
    description?: string,
  ) {
    return this.prisma.withReview('customer', async (tx) => {
      const actor = authActor(identity);
      const reporter = {
        customerId: actor.type === 'customer' ? actor.id : undefined,
        employeeId: actor.type === 'employee' ? actor.id : undefined,
        role: actor.role,
      };
      // 1. Rate limit check (if customer)
      if (reporter.customerId) {
        this.checkReportRateLimit(reporter.customerId);
      }

      // 2. Verify review exists
      const review = await tx.reviews.findUnique({
        where: { id: reviewId },
      });
      if (!review) {
        throw new BadRequestException(`Review #${reviewId} not found`);
      }

      // 3. Check if this reporter already reported this review
      const existingReportWhere: any = { review_id: reviewId };
      if (reporter.customerId) {
        existingReportWhere.reporter_customer_id = reporter.customerId;
      } else if (reporter.employeeId) {
        existingReportWhere.reporter_employee_id = reporter.employeeId;
      }

      const existingReport = await tx.moderation_reports.findFirst({
        where: existingReportWhere,
      });
      if (existingReport) {
        throw new BadRequestException('You have already submitted a report for this review.');
      }

      // 3. Create report record
      const report = await tx.moderation_reports.create({
        data: {
          review_id: reviewId,
          reporter_customer_id: reporter.customerId || null,
          reporter_employee_id: reporter.employeeId || null,
          reason,
          description: description ? this.sanitizeText(description) : null,
          status: 'PENDING',
        },
        include: {
          reviews: {
            select: { id: true, comment: true, status: true },
          },
        },
      });

      // 4. Log to audit trail
      await this.logAudit({
        reviewId,
        action: reporter.employeeId ? 'STAFF_REPORT' : 'USER_REPORT',
        customerId: reporter.customerId,
        employeeId: reporter.employeeId,
        role: reporter.role || (reporter.employeeId ? 'EMPLOYEE' : 'CUSTOMER'),
        reason: `Reported by ${reporter.employeeId ? 'staff' : 'user'} as ${reason}: ${description || 'No description'}`,
        meta: { reportId: report.id, reason, description },
      }, tx);

      return {
        success: true,
        message: 'Review reported successfully. Our moderation team will investigate.',
        data: report,
      };
    }, authActor(identity));
  }

  /**
   * Admin: Get paginated moderation reports with filters
   */
  async getReportsForAdmin(query: {
    page?: number;
    limit?: number;
    status?: string;
    reason?: string;
  }, user: CurrentUserPayload) {
    return this.prisma.withReview('moderator', async (tx) => {
      const page = Math.max(1, query?.page || 1);
      const limit = Math.max(1, Math.min(100, query?.limit || 10));
      const skip = (page - 1) * limit;

      const where: any = {};
      if (query?.status && query.status !== 'ALL') {
        where.status = query.status;
      }
      if (query?.reason) {
        where.reason = query.reason;
      }

      const [total, records] = await Promise.all([
        tx.moderation_reports.count({ where }),
        tx.moderation_reports.findMany({
          where,
          skip,
          take: limit,
          orderBy: { created_at: 'desc' },
          include: {
            reviews: {
              select: {
                id: true,
                comment: true,
                rating_stars: true,
                status: true,
                created_at: true,
                medicines: {
                  select: { id: true, medicine_name: true, slug: true, image_url: true },
                },
                customers: {
                  select: { id: true, full_name: true, email: true },
                },
              },
            },
            reporter_customer: {
              select: { id: true, full_name: true, email: true },
            },
            reporter_employee: {
              select: { id: true, full_name: true, email: true, role: true },
            },
            resolver_employee: {
              select: { id: true, full_name: true, role: true },
            },
          },
        }),
      ]);

      return {
        items: records,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit) || 1,
        },
      };
    }, authActor(user));
  }

  /**
   * Admin: Resolve a moderation report
   */
  async resolveReport(
    reportId: number,
    adminId: number,
    adminRole: string,
    resolverNote?: string,
    actionOnReview?: 'HIDE' | 'SPAM' | 'APPROVE' | 'KEEP',
  ) {
    return this.prisma.withReview('moderator', async (tx) => {
      const report = await tx.moderation_reports.findUnique({
        where: { id: reportId },
        include: { reviews: true },
      });

      if (!report) {
        throw new BadRequestException(`Report #${reportId} not found`);
      }

      const updatedReport = await tx.moderation_reports.update({
        where: { id: reportId },
        data: {
          status: 'RESOLVED',
          resolved_by_employee_id: adminId,
          resolver_note: resolverNote || 'Resolved by SuperAdmin',
          resolved_at: new Date(),
        },
      });

      // Optionally update review status if requested
      if (actionOnReview && actionOnReview !== 'KEEP') {
        await tx.reviews.update({
          where: { id: report.review_id },
          data: { status: actionOnReview === 'HIDE' ? 'HIDDEN' : actionOnReview === 'APPROVE' ? 'APPROVED' : actionOnReview },
        });
      }

      // Log to audit
      await this.logAudit({
        reviewId: report.review_id,
        action: 'RESOLVE_REPORT',
        employeeId: adminId,
        role: adminRole,
        reason: resolverNote || 'Report resolved',
        meta: { reportId, actionOnReview },
      }, tx);

      return {
        success: true,
        message: `Report #${reportId} has been resolved successfully.`,
        data: updatedReport,
      };
    }, authActor({ id: adminId, role: adminRole, type: 'employee' }));
  }

  /**
   * Admin: Dismiss a moderation report
   */
  async dismissReport(
    reportId: number,
    adminId: number,
    adminRole: string,
    resolverNote?: string,
  ) {
    return this.prisma.withReview('moderator', async (tx) => {
      const report = await tx.moderation_reports.findUnique({
        where: { id: reportId },
      });

      if (!report) {
        throw new BadRequestException(`Report #${reportId} not found`);
      }

      const updated = await tx.moderation_reports.update({
        where: { id: reportId },
        data: {
          status: 'DISMISSED',
          resolved_by_employee_id: adminId,
          resolver_note: resolverNote || 'Report dismissed as invalid',
          resolved_at: new Date(),
        },
      });

      await this.logAudit({
        reviewId: report.review_id,
        action: 'DISMISS_REPORT',
        employeeId: adminId,
        role: adminRole,
        reason: resolverNote || 'Report dismissed',
        meta: { reportId },
      }, tx);

      return {
        success: true,
        message: `Report #${reportId} dismissed.`,
        data: updated,
      };
    }, authActor({ id: adminId, role: adminRole, type: 'employee' }));
  }

  /**
   * Admin: Get paginated audit trail
   */
  async getAuditLogs(query: {
    page?: number;
    limit?: number;
    reviewId?: number;
    action?: string;
  }, user: CurrentUserPayload) {
    return this.prisma.withReview('moderator', async (tx) => {
      const page = Math.max(1, query?.page || 1);
      const limit = Math.max(1, Math.min(100, query?.limit || 20));
      const skip = (page - 1) * limit;

      const where: any = {};
      if (query?.reviewId) {
        where.review_id = query.reviewId;
      }
      if (query?.action) {
        where.action = query.action;
      }

      const [total, records] = await Promise.all([
        tx.moderation_audit_logs.count({ where }),
        tx.moderation_audit_logs.findMany({
          where,
          skip,
          take: limit,
          orderBy: { created_at: 'desc' },
          include: {
            reviews: {
              select: {
                id: true,
                comment: true,
                rating_stars: true,
                status: true,
                medicines: {
                  select: { id: true, medicine_name: true },
                },
              },
            },
            performed_by_employee: {
              select: { id: true, full_name: true, role: true, email: true },
            },
            performed_by_customer: {
              select: { id: true, full_name: true, email: true },
            },
          },
        }),
      ]);

      return {
        items: records,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit) || 1,
        },
      };
    }, authActor(user));
  }
}
