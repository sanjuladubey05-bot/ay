import type { EnvReadinessSummary } from '../types/api';
import type { ChecklistItemState, ChecklistStatus } from '../types/database';

export interface ChecklistDefinition {
  stepNumber: number;
  key: string;
  title: string;
  description: string;
  category: 'merchant_kyc' | 'technical_test' | 'live_cutover';
  docsUrl: string;
  docsLabel: string;
  requiresExternalPortal: boolean;
}

export const RAZORPAY_CHECKLIST_DEFINITIONS: readonly ChecklistDefinition[] = [
  {
    stepNumber: 1,
    key: 'merchant_account_registration',
    title: 'Merchant account registration',
    description:
      'Register the official LPS STORE business entity inside the Razorpay Merchant Dashboard.',
    category: 'merchant_kyc',
    docsUrl: 'https://razorpay.com/docs/payments/dashboard/account-setup/',
    docsLabel: 'Account Setup Docs',
    requiresExternalPortal: true,
  },
  {
    stepNumber: 2,
    key: 'business_category_verification',
    title: 'Business category verification',
    description:
      'Declare digital gaming top-ups / virtual goods MCC and confirm eligible payment methods (including UPI).',
    category: 'merchant_kyc',
    docsUrl: 'https://razorpay.com/docs/payments/dashboard/account-setup/kyc/',
    docsLabel: 'Category & KYC Docs',
    requiresExternalPortal: true,
  },
  {
    stepNumber: 3,
    key: 'kyc_completion',
    title: 'KYC completion',
    description:
      'Complete identity and business verification directly in the official Razorpay portal (never upload PAN/Aadhaar here).',
    category: 'merchant_kyc',
    docsUrl: 'https://razorpay.com/docs/payments/dashboard/account-setup/kyc/',
    docsLabel: 'Razorpay KYC Guide',
    requiresExternalPortal: true,
  },
  {
    stepNumber: 4,
    key: 'bank_account_verification',
    title: 'Bank account verification',
    description:
      'Verify settlement bank account and penny-drop confirmation inside the Razorpay Merchant Dashboard.',
    category: 'merchant_kyc',
    docsUrl: 'https://razorpay.com/docs/payments/settlements/',
    docsLabel: 'Settlements Docs',
    requiresExternalPortal: true,
  },
  {
    stepNumber: 5,
    key: 'business_website_review',
    title: 'Business website review',
    description:
      'Publish required storefront pages (Contact, Terms, Refund Policy, Privacy Policy) for Razorpay compliance review.',
    category: 'merchant_kyc',
    docsUrl: 'https://razorpay.com/docs/payments/dashboard/account-setup/website-verification/',
    docsLabel: 'Website Review Docs',
    requiresExternalPortal: true,
  },
  {
    stepNumber: 6,
    key: 'payment_gateway_activation',
    title: 'Payment gateway activation',
    description:
      'Receive formal Razorpay merchant approval and payment gateway activation confirmation.',
    category: 'merchant_kyc',
    docsUrl: 'https://razorpay.com/docs/payments/payment-gateway/web-integration/standard/',
    docsLabel: 'Standard Checkout Docs',
    requiresExternalPortal: true,
  },
  {
    stepNumber: 7,
    key: 'test_api_keys_configured',
    title: 'Test API keys configured',
    description:
      'Supply server-side RAZORPAY_KEY_ID (rzp_test_*) and RAZORPAY_KEY_SECRET environment variables.',
    category: 'technical_test',
    docsUrl: 'https://razorpay.com/docs/api/authentication/',
    docsLabel: 'API Keys Docs',
    requiresExternalPortal: false,
  },
  {
    stepNumber: 8,
    key: 'test_checkout_verified',
    title: 'Test checkout verified',
    description:
      'Verify end-to-end Razorpay Test Mode order creation, checkout flow, and server-side signature validation.',
    category: 'technical_test',
    docsUrl: 'https://razorpay.com/docs/payments/payment-gateway/web-integration/standard/build-integration/',
    docsLabel: 'Integration Verification',
    requiresExternalPortal: false,
  },
  {
    stepNumber: 9,
    key: 'webhook_configured',
    title: 'Webhook configured',
    description:
      'Configure /api/payments/webhook in Razorpay Dashboard and set RAZORPAY_WEBHOOK_SECRET on the server.',
    category: 'technical_test',
    docsUrl: 'https://razorpay.com/docs/webhooks/',
    docsLabel: 'Webhooks Docs',
    requiresExternalPortal: false,
  },
  {
    stepNumber: 10,
    key: 'live_api_credentials_configured',
    title: 'Live API credentials configured',
    description:
      'Generate and load production RAZORPAY_KEY_ID (rzp_live_*) and RAZORPAY_KEY_SECRET in server secrets.',
    category: 'live_cutover',
    docsUrl: 'https://razorpay.com/docs/payments/dashboard/account-settings/api-keys/',
    docsLabel: 'Live Keys Docs',
    requiresExternalPortal: false,
  },
  {
    stepNumber: 11,
    key: 'live_payment_tested',
    title: 'Live payment tested',
    description:
      'Execute a controlled low-value live transaction and verify UPI / card capture and receipt flow.',
    category: 'live_cutover',
    docsUrl: 'https://razorpay.com/docs/payments/payment-gateway/web-integration/standard/go-live-checklist/',
    docsLabel: 'Go-Live Checklist',
    requiresExternalPortal: false,
  },
  {
    stepNumber: 12,
    key: 'payment_reconciliation_verified',
    title: 'Payment reconciliation verified',
    description:
      'Confirm webhook events, payment_transactions records, and refund reconciliation match Razorpay settlements.',
    category: 'live_cutover',
    docsUrl: 'https://razorpay.com/docs/payments/settlements/reconcile/',
    docsLabel: 'Reconciliation Docs',
    requiresExternalPortal: false,
  },
];

export type StoredChecklistMap = Record<
  string,
  {
    status: ChecklistStatus;
    updatedAt: string | null;
    note: string;
  }
>;

export function buildChecklistState(
  stored: StoredChecklistMap,
  envReadiness: EnvReadinessSummary
): ChecklistItemState[] {
  return RAZORPAY_CHECKLIST_DEFINITIONS.map((def) => {
    const saved = stored[def.key];
    let effectiveStatus: ChecklistStatus = saved?.status || 'not_started';
    let note = saved?.note || '';

    // Never allow technical credential items to claim 'completed' if server env lacks the required keys.
    if (def.key === 'test_api_keys_configured') {
      const hasTestKeys =
        envReadiness.razorpayKeyType === 'test' &&
        envReadiness.razorpayKeySecretConfigured;
      if (!hasTestKeys && effectiveStatus === 'completed') {
        effectiveStatus = 'requires_attention';
        note = note || 'Test key credentials are not currently detected in server environment.';
      }
    }

    if (def.key === 'webhook_configured') {
      if (!envReadiness.razorpayWebhookSecretConfigured && effectiveStatus === 'completed') {
        effectiveStatus = 'requires_attention';
        note = note || 'RAZORPAY_WEBHOOK_SECRET is not detected in server environment.';
      }
    }

    if (def.key === 'live_api_credentials_configured') {
      const hasLiveKeys =
        envReadiness.razorpayKeyType === 'live' &&
        envReadiness.razorpayKeySecretConfigured;
      if (!hasLiveKeys && effectiveStatus === 'completed') {
        effectiveStatus = 'requires_attention';
        note = note || 'Live API credentials (rzp_live_*) are not detected in server environment.';
      }
    }

    return {
      ...def,
      status: effectiveStatus,
      updatedAt: saved?.updatedAt || null,
      note,
    };
  });
}

export function evaluateLiveModeEligibility(
  checklist: ChecklistItemState[],
  envReadiness: EnvReadinessSummary
): { eligible: boolean; blockers: string[] } {
  const blockers: string[] = [];

  if (envReadiness.razorpayKeyType !== 'live' || !envReadiness.razorpayKeySecretConfigured) {
    blockers.push('Live Razorpay API credentials (rzp_live_*) are not configured in server secrets.');
  }

  if (!envReadiness.razorpayWebhookSecretConfigured) {
    blockers.push('RAZORPAY_WEBHOOK_SECRET is missing from server environment.');
  }

  const requiredPriorKeys = [
    'merchant_account_registration',
    'business_category_verification',
    'kyc_completion',
    'bank_account_verification',
    'business_website_review',
    'payment_gateway_activation',
    'test_checkout_verified',
    'webhook_configured',
    'live_api_credentials_configured',
  ];

  for (const key of requiredPriorKeys) {
    const item = checklist.find((c) => c.key === key);
    if (!item || item.status !== 'completed') {
      blockers.push(`Checklist step "${item?.title || key}" is not marked Completed.`);
    }
  }

  return {
    eligible: blockers.length === 0,
    blockers,
  };
}
