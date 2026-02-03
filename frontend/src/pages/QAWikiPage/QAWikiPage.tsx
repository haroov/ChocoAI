/* eslint-disable */
import React from 'react';
import { useMainLayout } from '../../layouts/MainLayout';

export const QAWikiPage: React.FC = () => {
  useMainLayout({ title: 'QA Wiki' });

  return (
    <div className="p-8 max-w-[1200px] mx-auto min-h-screen bg-white text-gray-800 font-sans">
      <div className="prose prose-violet max-w-none">
        <h1 className="text-4xl font-bold mb-2 text-gray-900 border-b pb-4">ChocoAI V1 – QA Test Plan</h1>

        {/* 1. Product Goal */}
        <section className="mb-12">
          <h2 className="text-2xl font-bold mt-8 mb-4 text-gray-800">1. Product Goal (What We Are Testing For)</h2>
          <p className="mb-4">ChocoAI V1 exists to safely and smoothly onboard nonprofits into the Choco ecosystem, so they can reach a state where:</p>
          <blockquote className="border-l-4 border-[#882DD7] pl-4 italic bg-gray-50 p-4 rounded-r-lg mb-4">
            They are
            {' '}
            <strong>authenticated</strong>
            ,
            <strong>legally onboarded (KYC)</strong>
            , connected to a
            <strong>payment gateway</strong>
            , and ready to start building fundraising campaigns.
          </blockquote>
          <ul className="list-disc pl-6 space-y-2">
            <li>V1 is not about launching campaigns, optimizing strategy, or donor experiences.</li>
            <li>It is about removing friction, preventing dead ends, and establishing trust in the onboarding journey.</li>
          </ul>
          <p className="mt-4 font-semibold">The north star for QA is not "did every API call succeed" — it is:</p>
          <p className="bg-[#882DD7]/10 p-4 rounded-lg border border-[#882DD7]/20 text-[#2b0a4a] font-medium">
            Can a real nonprofit admin, with imperfect knowledge and messy data, reach a "ready to campaign" state without confusion, loops, or silent failures?
          </p>
        </section>

        {/* 2. Roadmap Context */}
        <section className="mb-12">
          <h2 className="text-2xl font-bold mt-8 mb-4 text-gray-800">2. Roadmap Context (What Is In / Out of Scope)</h2>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <div className="bg-green-50 p-6 rounded-xl border border-green-100">
              <h3 className="text-lg font-bold text-green-800 mb-3">V1 – In Scope (This Test Plan)</h3>
              <ul className="list-disc pl-5 space-y-1 text-sm text-green-900">
                <li>Welcome / Intent detection</li>
                <li>Authentication: Sign up (nonprofit + donor), Login, Smooth handoffs</li>
                <li>KYC: Organization & entity handling, Best-effort enrichment, Manual fallback</li>
                <li>Payment gateway setup</li>
                <li>Post-login routing to Campaign Management entry point</li>
                <li>Donor interim support flow (service-only, no product)</li>
              </ul>
            </div>

            <div className="bg-orange-50 p-6 rounded-xl border border-orange-100">
              <h3 className="text-lg font-bold text-orange-800 mb-3">V2+ – Explicitly Out of Scope</h3>
              <ul className="list-disc pl-5 space-y-1 text-sm text-orange-900">
                <li>Campaign Strategy AI</li>
                <li>Campaign Management features beyond entry</li>
                <li>Publishing campaigns</li>
                <li>Donor-facing product journeys</li>
                <li>Gateway verification / underwriting workflows</li>
                <li>Advanced UI tooling (CSS, creative, analytics)</li>
              </ul>
            </div>
          </div>

          <div className="mt-4 p-4 bg-gray-100 rounded-lg text-sm font-medium text-gray-600">
            QA rule: Once the system clearly states "we're ready to start your campaign now", the V1 test ends successfully.
          </div>
        </section>

        {/* 3. Testing Philosophy */}
        <section className="mb-12">
          <h2 className="text-2xl font-bold mt-8 mb-4 text-gray-800">3. Testing Philosophy & Approach</h2>

          <h3 className="text-xl font-semibold mt-6 mb-2">3.1 What QA Should Optimize For</h3>
          <ul className="list-disc pl-6 space-y-2 mb-4">
            <li>
              <strong>Continuity:</strong>
              {' '}
              no dead ends, no "now what?" moments
            </li>
            <li>
              <strong>Correct transitions:</strong>
              {' '}
              user is routed for the right reason
            </li>
            <li>
              <strong>Clear user-facing explanations:</strong>
              {' '}
              even when things fail
            </li>
            <li>
              <strong>Resilience:</strong>
              {' '}
              failures lead to recovery paths, not resets
            </li>
          </ul>

          <h3 className="text-xl font-semibold mt-6 mb-2">3.2 What QA Should Not Block On</h3>
          <ul className="list-disc pl-6 space-y-2 mb-4 text-gray-600">
            <li>Missing future features (V2+)</li>
            <li>Imperfect copy (unless misleading)</li>
            <li>Gateway verification states (only active=true matters)</li>
            <li>Internal API naming or tool sequencing (unless it affects UX)</li>
          </ul>

          <h3 className="text-xl font-semibold mt-6 mb-2">3.3 Where QA Verifies Behavior</h3>
          <div className="bg-gray-50 p-6 rounded-xl border border-gray-200">
            <p className="mb-4">QA should always validate behavior in two parallel views:</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <h4 className="font-bold mb-2">Conversation / Flow View</h4>
                <ul className="list-disc pl-5 text-sm">
                  <li>Stage progression</li>
                  <li>Agent messages</li>
                  <li>Visible routing decisions</li>
                </ul>
              </div>
              <div>
                <h4 className="font-bold mb-2">Conversation Details / Telemetry</h4>
                <ul className="list-disc pl-5 text-sm font-mono text-gray-700">
                  <li>intent_confidence</li>
                  <li>confirmation_asked</li>
                  <li>last_auth_error_code</li>
                  <li>auth_handoff_reason</li>
                  <li>kyc_completed</li>
                  <li>has_active_gateway</li>
                  <li>account_context_json snapshots</li>
                </ul>
              </div>
            </div>
            <p className="mt-4 text-red-600 text-sm font-bold">If UX and telemetry disagree → log as a bug, even if "it worked".</p>
          </div>
        </section>

        {/* 4. Core Success Criteria */}
        <section className="mb-12">
          <h2 className="text-2xl font-bold mt-8 mb-4 text-gray-800">4. Core Success Criteria (Definition of "Pass")</h2>
          <div className="border border-green-200 bg-green-50/50 p-6 rounded-xl">
            <ul className="space-y-3">
              <li className="flex items-start gap-2">
                <span className="text-green-500 font-bold">✓</span>
                <span>The user reaches the expected terminal state without manual intervention</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-green-500 font-bold">✓</span>
                <span>The system’s explanation to the user matches reality</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-green-500 font-bold">✓</span>
                <span>Internal routing decisions match documented business rules</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-green-500 font-bold">✓</span>
                <span>No data corruption occurs (e.g., OTP overwriting reg numbers)</span>
              </li>
            </ul>
          </div>
        </section>

        {/* 5. Test Coverage Overview */}
        <section className="mb-12">
          <h2 className="text-2xl font-bold mt-8 mb-4 text-gray-800">5. Test Coverage Overview (What QA Can Trust Today)</h2>
          <table className="min-w-full border border-gray-200 rounded-lg overflow-hidden">
            <thead className="bg-gray-100">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Area</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              <tr>
                <td className="px-6 py-4">Confidence-based intent confirmation</td>
                <td className="px-6 py-4">✅</td>
              </tr>
              <tr>
                <td className="px-6 py-4">Signup → Login handoff (already registered)</td>
                <td className="px-6 py-4">✅</td>
              </tr>
              <tr>
                <td className="px-6 py-4">Login → Signup handoff (no such user)</td>
                <td className="px-6 py-4">✅</td>
              </tr>
              <tr>
                <td className="px-6 py-4">Post-login routing on active gateway</td>
                <td className="px-6 py-4">✅</td>
              </tr>
              <tr>
                <td className="px-6 py-4">KYC completion requires active gateway</td>
                <td className="px-6 py-4">✅</td>
              </tr>
              <tr>
                <td className="px-6 py-4">Donor interim support flow</td>
                <td className="px-6 py-4">✅</td>
              </tr>
              <tr className="bg-yellow-50">
                <td className="px-6 py-4">Nonprofit Name given by user != data enrichment name</td>
                <td className="px-6 py-4">⚠️ Not implemented yet</td>
              </tr>
            </tbody>
          </table>
        </section>

        {/* 6. Detailed Test Scenarios */}
        <section className="mb-12">
          <h2 className="text-2xl font-bold mt-8 mb-4 text-gray-800">6. Detailed Test Scenarios</h2>

          <h3 className="text-xl font-bold text-gray-700 mt-6 mb-3 border-b pb-2">6.1 Welcome & Intent Detection</h3>
          <div className="space-y-4">
            <div className="p-4 bg-white border border-gray-200 rounded-lg shadow-sm">
              <h4 className="font-bold text-gray-900">W1 – Explicit Account Intent</h4>
              <p className="text-sm text-gray-600 italic mb-2">User: "I want to start a new campaign in my nonprofit account."</p>
              <p className="text-sm">
                <strong>Expected:</strong>
                {' '}
                No "do you have an account?" question. intent_confidence = high. Routed directly to login.
              </p>
            </div>
            <div className="p-4 bg-white border border-gray-200 rounded-lg shadow-sm">
              <h4 className="font-bold text-gray-900">W2 – Ambiguous Intent</h4>
              <p className="text-sm text-gray-600 italic mb-2">User: "I want to start a campaign"</p>
              <p className="text-sm">
                <strong>Expected:</strong>
                {' '}
                Agent asks: "Do you already have an account?" confirmation_asked = true.
              </p>
            </div>
            <div className="p-4 bg-white border border-gray-200 rounded-lg shadow-sm">
              <h4 className="font-bold text-gray-900">W3 – Learn Intent Loop</h4>
              <p className="text-sm text-gray-600 italic mb-2">User: "What is ChocoAI?" (repeated)</p>
              <p className="text-sm">
                <strong>Expected:</strong>
                {' '}
                After 2 loops, agent explicitly asks to register or log in. No silent routing.
              </p>
            </div>
          </div>

          <h3 className="text-xl font-bold text-gray-700 mt-8 mb-3 border-b pb-2">6.2 Authentication Flows</h3>
          <div className="space-y-4">
            <div className="p-4 bg-white border border-gray-200 rounded-lg shadow-sm">
              <h4 className="font-bold text-gray-900">A1 – New Nonprofit Signup (Happy Path)</h4>
              <p className="text-sm">
                <strong>Expected:</strong>
                {' '}
                Signup succeeds. Verification code handled correctly. Seamless transition into KYC. signup_status = success.
              </p>
            </div>
            <div className="p-4 bg-white border border-gray-200 rounded-lg shadow-sm">
              <h4 className="font-bold text-gray-900">A2 – Signup with Existing Account</h4>
              <p className="text-sm">
                <strong>Expected:</strong>
                {' '}
                auth_handoff_reason = already_registered. Agent says: "I sent you a code...". User never sees a "you failed" message.
              </p>
            </div>
            <div className="p-4 bg-white border border-gray-200 rounded-lg shadow-sm">
              <h4 className="font-bold text-gray-900">A3 – Login with Non-Existent Account</h4>
              <p className="text-sm">
                <strong>Expected:</strong>
                {' '}
                last_auth_error_code = no_such_user. Agent explains clearly and offers: Try another phone/email or Sign up instead.
              </p>
            </div>
          </div>

          {/* 6.3 Channel Surfaces (Widget + WhatsApp) */}
          <h3 className="text-xl font-bold text-gray-700 mt-8 mb-3 border-b pb-2">6.3 Channel Surfaces (Chat Widget + WhatsApp)</h3>
          <div className="space-y-4">
            <div className="p-4 bg-white border border-gray-200 rounded-lg shadow-sm">
              <h4 className="font-bold text-gray-900">CH1 – Web Chat Widget (Embedded)</h4>
              <p className="text-sm text-gray-600 mb-2">
                Entry point:
                {' '}
                <a className="text-[#882DD7] underline" href="https://www.chocoinsurance.com/?ai=1" target="_blank" rel="noreferrer">https://www.chocoinsurance.com/?ai=1</a>
              </p>
              <ul className="list-disc pl-6 space-y-1 text-sm">
                <li>Open the widget, start a fresh conversation, and confirm the first welcome message appears.</li>
                <li>Run a full happy path (Welcome → Login/Sign-up → KYC → Campaign Mgmt entry).</li>
                <li>Verify links render correctly (gateway setup links, any dashboard links) and are clickable.</li>
                <li>Verify message formatting: newlines, bullets, bold emphasis, and Hebrew/English consistency.</li>
                <li>Verify the Bug Report modal works from the conversation details panel.</li>
              </ul>
              <p className="text-sm mt-2">
                <strong>Expected:</strong>
                {' '}
                UX matches the main dashboard chat experience; no missing messages; no “out of sync” between chat and tool/API actions.
              </p>
            </div>

            <div className="p-4 bg-white border border-gray-200 rounded-lg shadow-sm">
              <h4 className="font-bold text-gray-900">CH2 – WhatsApp (Twilio)</h4>
              <p className="text-sm text-gray-600 mb-2">
                Test number:
                {' '}
                <span className="font-mono">+1 (219) 271-7734</span>
              </p>
              <ul className="list-disc pl-6 space-y-1 text-sm">
                <li>Send “היי” and verify the welcome intent question is delivered on WhatsApp.</li>
                <li>Run login/signup flows and confirm OTP messaging is clear (no technical jargon / no internal IDs).</li>
                <li>Verify long messages do not get truncated (or if they do, the experience remains coherent).</li>
                <li>Verify links are delivered in a WhatsApp-friendly way (full URL visible and clickable).</li>
                <li>Verify the system does not rely on UI-only elements (e.g., buttons/menus) to proceed.</li>
              </ul>
              <p className="text-sm mt-2">
                <strong>Expected:</strong>
                {' '}
                Same business logic as the web chat; only channel-specific differences should be formatting and delivery (not flow decisions).
              </p>
            </div>

            <div className="p-4 bg-yellow-50 border border-yellow-200 rounded-lg shadow-sm">
              <h4 className="font-bold text-yellow-900">CH3 – Cross-Channel Consistency Check</h4>
              <p className="text-sm text-yellow-900 mb-2">
                Run the same scenario in both channels (Widget + WhatsApp) and compare:
              </p>
              <ul className="list-disc pl-6 space-y-1 text-sm text-yellow-900">
                <li>Stage progression (no extra/missing stages).</li>
                <li>Tool calls + API calls (same calls, same org/entity scoping).</li>
                <li>Key telemetry fields: intent_confidence, confirmation_asked, last_auth_error_code, kyc_completed, has_active_gateway.</li>
              </ul>
              <p className="text-sm mt-2 text-yellow-900">
                <strong>Expected:</strong>
                {' '}
                Identical outcomes; any divergence is a bug to report.
              </p>
            </div>
          </div>
        </section>

        {/* KYC in Two Worlds */}
        <section className="mb-12 bg-violet-50 p-8 rounded-2xl border border-violet-100">
          <h2 className="text-3xl font-bold text-violet-900 mb-6">ChocoAI V1 – KYC in Two Worlds</h2>

          <div className="mb-6">
            <h3 className="text-xl font-bold text-indigo-800 mb-2">Shared Goal</h3>
            <p className="text-violet-900">
              KYC succeeds only when ChocoAI can truthfully say:
              <strong>"You're ready to start building a campaign now."</strong>
            </p>
            <ul className="list-disc pl-5 mt-2 text-indigo-800 text-sm">
              <li>We are operating inside a specific organization (working org)</li>
              <li>There is a legal entity under that org that receives funds</li>
              <li>That org has a payment gateway connected and active=true</li>
              <li>All actions were applied to the correct org/entity (no cross-org leakage)</li>
            </ul>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            {/* World A */}
            <div className="bg-white p-6 rounded-xl border border-indigo-200 shadow-sm">
              <h3 className="text-xl font-bold text-indigo-700 border-b border-indigo-100 pb-2 mb-4">World A: New User Journey</h3>
              <h4 className="font-semibold text-sm mb-1 uppercase tracking-wide text-gray-500">Validation Checkpoints</h4>
              <ul className="space-y-3 text-sm">
                <li>
                  <strong className="block text-gray-800">Checkpoint 1 — Org creation</strong>
                  An organization now exists and becomes the working org.
                </li>
                <li>
                  <strong className="block text-gray-800">Checkpoint 2 — Entity creation</strong>
                  Entity created under THAT working org. Details match input.
                </li>
                <li>
                  <strong className="block text-gray-800">Checkpoint 3 — Gateway setup</strong>
                  Gateway created under that same working org. active=true.
                </li>
              </ul>
              <div className="mt-4 bg-red-50 p-3 rounded text-xs text-red-700">
                <strong>Common Failure:</strong>
                {' '}
                Entity created under wrong org. Gateway created under different org than entity.
              </div>
            </div>

            {/* World B */}
            <div className="bg-white p-6 rounded-xl border border-indigo-200 shadow-sm">
              <h3 className="text-xl font-bold text-purple-700 border-b border-purple-100 pb-2 mb-4">World B: Returning User</h3>
              <h4 className="font-semibold text-sm mb-1 uppercase tracking-wide text-gray-500">Validation Checkpoints</h4>
              <ul className="space-y-3 text-sm">
                <li>
                  <strong className="block text-gray-800">Checkpoint 1 — Org scoping</strong>
                  Entity/Gateway lists shown are ONLY for the selected org.
                </li>
                <li>
                  <strong className="block text-gray-800">Checkpoint 2 — Entity scoping</strong>
                  Selecting existing entity does not duplicate. New entity pushed to selected org.
                </li>
                <li>
                  <strong className="block text-gray-800">Checkpoint 3 — Gateway scoping</strong>
                  Gateway discovery is org-scoped. Active gateway in Org A does NOT allow skipping KYC for Org B.
                </li>
              </ul>
              <div className="mt-4 bg-red-50 p-3 rounded text-xs text-red-700">
                <strong>Common Failure:</strong>
                {' '}
                Cross-org contamination. User has active gateway in Org A, but working in Org B (should not skip).
              </div>
            </div>
          </div>
        </section>

        {/* 9. Bug Reporting */}
        <section className="mb-12">
          <h2 className="text-2xl font-bold mt-8 mb-4 text-gray-800">9. How to Report Bugs & Issues</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="border border-gray-200 rounded-xl p-6">
              <h3 className="text-lg font-bold mb-2">9.1 LLM / Flow Bugs</h3>
              <p className="text-sm text-gray-600 mb-4">Wrong flow routing, missing questions, incorrect intent, telemetry mismatches.</p>
              <div className="bg-[#882DD7]/10 p-3 rounded text-sm text-[#2b0a4a] font-medium">
                Report inside ChocoAI (🚩 flag)
              </div>
            </div>
            <div className="border border-gray-200 rounded-xl p-6">
              <h3 className="text-lg font-bold mb-2">9.2 System Bugs</h3>
              <p className="text-sm text-gray-600 mb-4">Backend behavior, dashboards, gateway issues, environment problems.</p>
              <div className="bg-red-50 p-3 rounded text-sm text-red-800 font-medium">
                Report in Asana
              </div>
            </div>
          </div>
        </section>

        {/* Personas */}
        <section className="mb-20">
          <h2 className="text-2xl font-bold mt-8 mb-6 text-gray-800">Specific Test Personas</h2>
          <div className="space-y-6">
            {[
              { name: 'Persona 1 — Israeli nonprofit owner, brand new', story: 'No account. Welcome -> Signup -> KYC -> Org/Entity/Gateway created.', verify: 'Org + Entity + Gateway created under correct context.' },
              { name: 'Persona 2 — US nonprofit employee, returning', story: 'Has account. Login -> Choose Org -> KYC for THAT org only.', verify: 'No accidental skip due to other orgs. Gateway added to chosen org.' },
              { name: 'Persona 3 — Independent campaign operator', story: 'Runs multiple charities. Login -> Choose Org -> Fast-path if gateway exists.', verify: 'Org selection locked. Fast-path only if gateway is active for selected org.' },
              { name: 'Persona 4 — French donor', story: 'Donor wants to run campaign. Support flow or Nonprofit conversion.', verify: 'Donor not pushed to KYC without context.' },
              { name: 'Persona 5 — Returning Admin (Fully Setup)', story: 'Everything ready. Login -> Campaign Mgmt.', verify: 'Immediate entry.' },
              { name: 'Persona 7 — Israeli Meshulam Phone Issue', story: 'Bad phone format. Login -> Resume KYC -> Gateway -> Retry.', verify: 'Gateway created under correct org after retry.' },
            ].map((p, i) => (
              <div key={i} className="bg-gray-50 p-4 rounded-lg border border-gray-100">
                <h4 className="font-bold text-gray-900">{p.name}</h4>
                <p className="text-sm mt-1 text-gray-700">{p.story}</p>
                <p className="text-xs mt-2 text-[#882DD7] font-medium">
                  Verify:
                  {p.verify}
                </p>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
};
