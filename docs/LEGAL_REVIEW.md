# Items requiring attorney review

Nothing in this repository is legal advice. Have a licensed attorney in your
state review the following before launch. The dashboard labels agreement
templates as drafts until attorney approval is recorded.

## Agreements (Settings → Agreements)

| Agreement | Status in repo | Notes |
| --- | --- | --- |
| Dispatch Service Agreement | Draft template (`0.1-draft`) | Services, fees (percentage or flat weekly per truck), eligible revenue and accessorials, billing and payment terms, cancellation notice period (setting `cancellation_notice_days`, default 14), carrier's authority and insurance responsibilities, no guarantees, independent-contractor relationship, limitation of liability, governing law, electronic signature consent. |
| Broker and Load-Board Authorization Acknowledgment | Draft template | Scope of authority to contact brokers, submit carrier packets and negotiate on the carrier's behalf; carrier approval required for every load. |
| Limited Power of Attorney | Draft; **cannot be published without recorded attorney approval** | Only if you choose to sign rate confirmations for carriers. Consider whether to offer it at all. |
| Owner-Operator Lease | Prepared only; lease-on disabled | Required only if the company obtains its own authority (see LEASE_ON.md); must satisfy 49 CFR Part 376. |

Every acceptance records version, timestamp, user, IP address, browser and the
SHA-256 of the exact text. Confirm this evidence meets E-SIGN/UETA
requirements in your jurisdiction and whether additional consent language is
needed.

## Public pages and emails

- Privacy policy (`/privacy`): data collected (application data, EIN last four,
  documents, IP/UA for consent and acceptances), retention periods, service
  providers (Supabase, Vercel, Resend, Stripe, Sentry, PostHog), state privacy
  law obligations, and SMS consent if you add texting.
- Terms of service (`/terms`), dispatch relationship disclosure
  (`/dispatch-disclosure`) and the application consent text
  (`SUBMISSION_CONSENT_VERSION` in `src/lib/validation/application.ts`).
- Marketing claims: the copy avoids guarantees, income claims and
  "licensed dispatcher" language (enforced by tests). Review any new copy.
- Collections: invoice reminder wording and late-payment terms.

## Operations

- Whether any state requires registration for dispatch services where you operate.
- Record retention for documents, agreements, audit logs and financial records.
- Insurance for the dispatch business (errors & omissions, cyber).
- Handling of carrier cancellation, final statements and outstanding invoices.
