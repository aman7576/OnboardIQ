import { lazy, Suspense, type ReactNode } from 'react';
import { Navigate, Route, Routes } from 'react-router';
import { RequireRole } from '@/components/layout/RequireRole';
import { AppShell } from '@/components/layout/AppShell';
import { ApplicantDashboard } from '@/features/applicant/ApplicantDashboard';
import { ApplicationDetails } from '@/features/applicant/ApplicationDetails';
import { DocumentUpload } from '@/features/applicant/DocumentUpload';
import { NewApplication } from '@/features/applicant/NewApplication';
import { LoginPage } from '@/features/auth/LoginPage';
import { OfficerLoginPage } from '@/features/auth/OfficerLoginPage';
import { OfficerRegisterPage } from '@/features/auth/OfficerRegisterPage';
import { RegisterPage } from '@/features/auth/RegisterPage';
import { Maintenance } from '@/features/compliance/Maintenance';
import { useAuth } from '@/features/auth/useAuth';
import { AuditViewer } from '@/features/compliance/AuditViewer';
import { ComplianceDashboard } from '@/features/compliance/ComplianceDashboard';
import { CaseReview } from '@/features/review/CaseReview';
import { ReviewQueue } from '@/features/review/ReviewQueue';
import { HOME_BY_ROLE } from '@/lib/navigation';
import type { Role } from '@/api/types';

// Loaded on demand: it pulls in the markdown renderer, which no other page needs.
const AiEvaluation = lazy(() =>
  import('@/features/compliance/AiEvaluation').then((m) => ({ default: m.AiEvaluation })),
);

const APPLICANT: Role[] = ['APPLICANT'];
const OFFICER: Role[] = ['KYC_OFFICER'];
const COMPLIANCE: Role[] = ['COMPLIANCE_OFFICER'];
const STAFF: Role[] = ['KYC_OFFICER', 'COMPLIANCE_OFFICER'];

function Guard({ roles, children }: { roles: Role[]; children: ReactNode }) {
  return <RequireRole roles={roles}>{children}</RequireRole>;
}

function Home() {
  const { state } = useAuth();
  if (state.status === 'checking')
    return (
      <p role="status" className="p-8 text-ink-soft">
        Checking your session…
      </p>
    );
  if (state.status !== 'authenticated') return <Navigate to="/login" replace />;
  return <Navigate to={HOME_BY_ROLE[state.user.role]} replace />;
}

function Register() {
  const { state } = useAuth();
  if (state.status === 'authenticated')
    return <Navigate to={HOME_BY_ROLE[state.user.role]} replace />;
  return (
    <div className="min-h-screen bg-ivory">
      <RegisterPage />
    </div>
  );
}

function Login() {
  const { state } = useAuth();
  if (state.status === 'authenticated')
    return <Navigate to={HOME_BY_ROLE[state.user.role]} replace />;
  return (
    <div className="min-h-screen bg-ivory">
      <LoginPage />
    </div>
  );
}

/** Public pages: someone who is already signed in goes straight to their own home. */
function Public({ children }: { children: ReactNode }) {
  const { state } = useAuth();
  if (state.status === 'authenticated')
    return <Navigate to={HOME_BY_ROLE[state.user.role]} replace />;
  return <div className="min-h-screen bg-ivory">{children}</div>;
}

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route
        path="/officer/login"
        element={
          <Public>
            <OfficerLoginPage />
          </Public>
        }
      />
      <Route
        path="/officer/register"
        element={
          <Public>
            <OfficerRegisterPage />
          </Public>
        }
      />
      <Route path="/" element={<Home />} />
      <Route element={<AppShell />}>
        <Route
          path="/applications"
          element={
            <Guard roles={APPLICANT}>
              <ApplicantDashboard />
            </Guard>
          }
        />
        <Route
          path="/applications/new"
          element={
            <Guard roles={APPLICANT}>
              <NewApplication />
            </Guard>
          }
        />
        <Route
          path="/applications/:id"
          element={
            <Guard roles={APPLICANT}>
              <ApplicationDetails />
            </Guard>
          }
        />
        <Route
          path="/applications/:id/upload"
          element={
            <Guard roles={APPLICANT}>
              <DocumentUpload />
            </Guard>
          }
        />
        <Route
          path="/review"
          element={
            <Guard roles={OFFICER}>
              <ReviewQueue mode="officer" />
            </Guard>
          }
        />
        <Route
          path="/checker"
          element={
            <Guard roles={COMPLIANCE}>
              <ReviewQueue mode="checker" />
            </Guard>
          }
        />
        <Route
          path="/cases/:id"
          element={
            <Guard roles={STAFF}>
              <CaseReview />
            </Guard>
          }
        />
        <Route
          path="/dashboard"
          element={
            <Guard roles={COMPLIANCE}>
              <ComplianceDashboard />
            </Guard>
          }
        />
        <Route
          path="/maintenance"
          element={
            <Guard roles={COMPLIANCE}>
              <Maintenance />
            </Guard>
          }
        />
        <Route
          path="/audit"
          element={
            <Guard roles={COMPLIANCE}>
              <AuditViewer />
            </Guard>
          }
        />
        <Route
          path="/ai-evaluation"
          element={
            <Guard roles={COMPLIANCE}>
              <Suspense
                fallback={
                  <p role="status" className="text-ink-soft">
                    Loading…
                  </p>
                }
              >
                <AiEvaluation />
              </Suspense>
            </Guard>
          }
        />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
