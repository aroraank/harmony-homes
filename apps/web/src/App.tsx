import { lazy, Suspense, type ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './lib/auth';
import { isConfigured } from './lib/supabase';
import { AppShell } from './components/shell/AppShell';
import { Splash } from './components/Splash';
import { ErrorState } from './components/States';
import { Button } from './components/ui/button';
import LoginPage from './pages/auth/LoginPage';
import HomePage from './pages/HomePage';

const RecurringPage = lazy(() => import('./pages/events/RecurringPage'));
// Self-registration is disabled: new residents are added by the admin, not via /register.
const ChangePasswordPage = lazy(() => import('./pages/auth/ChangePasswordPage'));
const NoAccessPage = lazy(() => import('./pages/auth/NoAccessPage'));
const SetupNeededPage = lazy(() => import('./pages/auth/SetupNeededPage'));
const VerifyReceiptPage = lazy(() => import('./pages/public/VerifyReceiptPage'));
const DuesPage = lazy(() => import('./pages/dues/DuesPage'));
const PayPage = lazy(() => import('./pages/dues/PayPage'));
const ReceiptPage = lazy(() => import('./pages/dues/ReceiptPage'));
const LedgerPage = lazy(() => import('./pages/ledger/LedgerPage'));
const EventsPage = lazy(() => import('./pages/events/EventsPage'));
const EventDetailPage = lazy(() => import('./pages/events/EventDetailPage'));
const EventCreatePage = lazy(() => import('./pages/events/EventCreatePage'));
const MeetingsPage = lazy(() => import('./pages/meetings/MeetingsPage'));
const MeetingDetailPage = lazy(() => import('./pages/meetings/MeetingDetailPage'));
const MeetingComposePage = lazy(() => import('./pages/meetings/MeetingComposePage'));
const NoticesPage = lazy(() => import('./pages/notices/NoticesPage'));
const NoticeDetailPage = lazy(() => import('./pages/notices/NoticeDetailPage'));
const NoticeComposePage = lazy(() => import('./pages/notices/NoticeComposePage'));
const ReportsPage = lazy(() => import('./pages/reports/ReportsPage'));
const MonthReportPage = lazy(() => import('./pages/reports/MonthReportPage'));
const UnitStatementPage = lazy(() => import('./pages/reports/UnitStatementPage'));
const DefaultersPage = lazy(() => import('./pages/reports/DefaultersPage'));
const PayeeHistoryPage = lazy(() => import('./pages/reports/PayeeHistoryPage'));
const PositionPage = lazy(() => import('./pages/reports/PositionPage'));
const FeedbackPage = lazy(() => import('./pages/feedback/FeedbackPage'));
const ConcernsPage = lazy(() => import('./pages/concerns/ConcernsPage'));
const ConcernNewPage = lazy(() => import('./pages/concerns/ConcernNewPage'));
const ConcernDetailPage = lazy(() => import('./pages/concerns/ConcernDetailPage'));
const ContactsPage = lazy(() => import('./pages/contacts/ContactsPage'));
const RemindersPage = lazy(() => import('./pages/reminders/RemindersPage'));
const MorePage = lazy(() => import('./pages/more/MorePage'));
const ProfilePage = lazy(() => import('./pages/more/ProfilePage'));
const NotificationsPage = lazy(() => import('./pages/more/NotificationsPage'));
const RecordPaymentPage = lazy(() => import('./pages/admin/RecordPaymentPage'));
const RecordExpensePage = lazy(() => import('./pages/admin/RecordExpensePage'));
const ClaimsPage = lazy(() => import('./pages/admin/ClaimsPage'));
const DuesAdminPage = lazy(() => import('./pages/admin/DuesAdminPage'));
const ExpensesAdminPage = lazy(() => import('./pages/admin/ExpensesAdminPage'));
const UnitsPage = lazy(() => import('./pages/admin/UnitsPage'));
const MembersPage = lazy(() => import('./pages/admin/MembersPage'));
const SettingsPage = lazy(() => import('./pages/admin/SettingsPage'));
const AuditPage = lazy(() => import('./pages/admin/AuditPage'));
const AlertsPage = lazy(() => import('./pages/admin/AlertsPage'));
// Move money between funds: disabled for now.
// const TransferPage = lazy(() => import('./pages/admin/TransferPage'));

function Protected() {
  const { loading, session, ctx, ctxLoading, ctxError, active, signOut } = useAuth();
  const loc = useLocation();
  if (loading) return <Splash />;
  if (!session) return <Navigate to="/login" replace state={{ from: loc.pathname }} />;
  if (ctxLoading && !ctx) return <Splash />;
  if (ctxError && !ctx)
    return (
      <div className="grid min-h-dvh place-items-center p-6">
        <div>
          <ErrorState error={ctxError} onRetry={() => window.location.reload()} />
          <Button variant="ghost" className="w-full" onClick={() => void signOut()}>
            Sign out
          </Button>
        </div>
      </div>
    );
  if (ctx?.profile?.must_change_password) return <Navigate to="/change-password" replace />;
  if (!active)
    return (
      <Suspense fallback={<Splash />}>
        <NoAccessPage />
      </Suspense>
    );
  return <AppShell />;
}

function Lazy({ children }: { children: ReactNode }) {
  return <Suspense fallback={<Splash />}>{children}</Suspense>;
}

export default function App() {
  if (!isConfigured)
    return (
      <Lazy>
        <SetupNeededPage />
      </Lazy>
    );
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<Navigate to="/" replace />} />
      <Route
        path="/r/:token"
        element={
          <Lazy>
            <VerifyReceiptPage />
          </Lazy>
        }
      />
      <Route
        path="/change-password"
        element={
          <Lazy>
            <ChangePasswordPage />
          </Lazy>
        }
      />
      <Route element={<Protected />}>
        <Route index element={<HomePage />} />
        <Route path="dues" element={<DuesPage />} />
        <Route path="pay" element={<PayPage />} />
        <Route path="receipts/:entryId" element={<ReceiptPage />} />
        <Route path="ledger" element={<LedgerPage />} />
        <Route path="events" element={<EventsPage />} />
        <Route path="events/new" element={<EventCreatePage />} />
        <Route
          path="events/recurring"
          element={
            <Lazy>
              <RecurringPage />
            </Lazy>
          }
        />
        <Route path="events/:id" element={<EventDetailPage />} />
        <Route path="meetings" element={<MeetingsPage />} />
        <Route path="meetings/new" element={<MeetingComposePage />} />
        <Route path="meetings/:id" element={<MeetingDetailPage />} />
        <Route path="meetings/:id/edit" element={<MeetingComposePage />} />
        <Route path="notices" element={<NoticesPage />} />
        <Route path="notices/new" element={<NoticeComposePage />} />
        <Route path="notices/:id" element={<NoticeDetailPage />} />
        <Route path="reports" element={<ReportsPage />} />
        <Route path="reports/month/:period?" element={<MonthReportPage />} />
        <Route path="reports/unit/:unitId?" element={<UnitStatementPage />} />
        <Route path="reports/pending" element={<DefaultersPage />} />
        <Route path="reports/position" element={<PositionPage />} />
        <Route path="feedback" element={<FeedbackPage />} />
        <Route path="reports/defaulters" element={<Navigate to="/reports/pending" replace />} />
        <Route path="reports/payees" element={<PayeeHistoryPage />} />
        <Route path="concerns" element={<ConcernsPage />} />
        <Route path="concerns/new" element={<ConcernNewPage />} />
        <Route path="concerns/:id" element={<ConcernDetailPage />} />
        <Route path="contacts" element={<ContactsPage />} />
        <Route path="reminders" element={<RemindersPage />} />
        <Route path="more" element={<MorePage />} />
        <Route path="profile" element={<ProfilePage />} />
        <Route path="notifications" element={<NotificationsPage />} />
        <Route path="admin/payment" element={<RecordPaymentPage />} />
        <Route path="admin/expense" element={<RecordExpensePage />} />
        <Route path="admin/claims" element={<ClaimsPage />} />
        <Route path="admin/dues" element={<DuesAdminPage />} />
        <Route path="admin/expenses" element={<ExpensesAdminPage />} />
        <Route path="admin/units" element={<UnitsPage />} />
        <Route path="admin/members" element={<MembersPage />} />
        <Route path="admin/settings" element={<SettingsPage />} />
        <Route path="admin/audit" element={<AuditPage />} />
        <Route path="admin/alerts" element={<AlertsPage />} />
        {/* Move money between funds: disabled for now — redirect any direct link to home. */}
        <Route path="admin/transfer" element={<Navigate to="/" replace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
