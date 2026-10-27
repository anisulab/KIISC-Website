import { lazy, type ComponentType } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { LanguageProvider } from '@/i18n/LanguageProvider';
import { AuthProvider } from '@/auth/AuthProvider';
import { RequireRoles } from '@/auth/guards';
import {
  ACADEMIC_ADMIN_ROLES,
  ADMISSION_VIEW_ROLES,
  ATTENDANCE_VIEW_ROLES,
  EXAM_VIEW_ROLES,
  FINANCE_MANAGE_ROLES,
  FINANCE_VIEW_ROLES,
  TEACHING_ADMIN_ROLES,
  AUDIT_ROLES,
  CONTENT_ROLES,
  NOTIFICATION_ROLES,
  REPORT_ROLES,
  SETTINGS_VIEW_ROLES,
  STUDENT_MANAGE_ROLES,
  STUDENT_VIEW_ROLES,
  USER_ADMIN_ROLES,
} from '@/auth/roles';
import { InstitutionProvider } from '@/hooks/useInstitution';
import PublicLayout from '@/components/layout/PublicLayout';
import HomePage from '@/pages/public/HomePage';
import type { ContentKind } from '@/pages/admin/content/config';

// Route-level code splitting keeps the first load small on slower connections.
const named = <T extends Record<string, unknown>>(loader: () => Promise<T>, name: keyof T) =>
  lazy(() => loader().then((m) => ({ default: m[name] as ComponentType })));

const about = () => import('@/pages/public/AboutPages');
const academic = () => import('@/pages/public/AcademicPages');
const admission = () => import('@/pages/public/AdmissionPages');
const info = () => import('@/pages/public/InfoPages');
const notices = () => import('@/pages/public/NoticePages');
const events = () => import('@/pages/public/EventPages');
const media = () => import('@/pages/public/MediaPages');
const auth = () => import('@/pages/auth/AuthPages');

const AboutPage = named(about, 'AboutPage');
const MissionVisionPage = named(about, 'MissionVisionPage');
const FacultyPage = named(about, 'FacultyPage');
const AcademicsPage = named(academic, 'AcademicsPage');
const StreamPage = lazy(() => academic().then((m) => ({ default: m.StreamPage })));
const AdmissionsPage = named(admission, 'AdmissionsPage');
const RequirementsPage = named(admission, 'RequirementsPage');
const ContactPage = named(info, 'ContactPage');
const FaqPage = named(info, 'FaqPage');
const PrivacyPage = named(info, 'PrivacyPage');
const TermsPage = named(info, 'TermsPage');
const NotFoundPage = named(info, 'NotFoundPage');
const NoticesPage = named(notices, 'NoticesPage');
const NoticeDetailPage = named(notices, 'NoticeDetailPage');
const EventsPage = named(events, 'EventsPage');
const CalendarPage = named(events, 'CalendarPage');
const GalleryPage = named(media, 'GalleryPage');
const ResourcesPage = named(media, 'ResourcesPage');
const ExaminationsPage = named(media, 'ExaminationsPage');
const LoginPage = named(auth, 'LoginPage');
const ResetPasswordPage = named(auth, 'ResetPasswordPage');

// Admin console (separate chunks; never loaded by public visitors).
const AdminLayout = lazy(() => import('@/components/admin/AdminLayout'));
const DashboardPage = lazy(() => import('@/pages/admin/DashboardPage'));
const SettingsPage = lazy(() => import('@/pages/admin/SettingsPage'));
const AuditPage = lazy(() => import('@/pages/admin/AuditPage'));
const AccountPage = lazy(() => import('@/pages/admin/AccountPage'));
const ReportsPage = lazy(() => import('@/pages/admin/ReportsPage'));
const NotificationsPage = lazy(() => import('@/pages/admin/NotificationsPage'));
const SecurityPage = lazy(() => import('@/pages/admin/SecurityPage'));
const users = () => import('@/pages/admin/UsersPages');
const UsersListPage = named(users, 'UsersListPage');
const UserDetailPage = named(users, 'UserDetailPage');
const content = () => import('@/pages/admin/content/ContentPages');
const ContentListPage = lazy(() => content().then((m) => ({ default: m.ContentListPage })));
const ContentEditPage = lazy(() => content().then((m) => ({ default: m.ContentEditPage })));

const AcademicSetupPage = lazy(() => import('@/pages/admin/AcademicSetupPage'));
const admissionsAdmin = () => import('@/pages/admin/AdmissionsAdminPages');
const ApplicationsListPage = named(admissionsAdmin, 'ApplicationsListPage');
const ApplicationDetailPage = named(admissionsAdmin, 'ApplicationDetailPage');
const AdmissionSettingsPage = named(admissionsAdmin, 'AdmissionSettingsPage');
const applyPages = () => import('@/pages/public/ApplyPages');
const AdmissionApplyPage = named(applyPages, 'AdmissionApplyPage');
const AdmissionStatusPage = named(applyPages, 'AdmissionStatusPage');

const students = () => import('@/pages/admin/StudentsPages');
const StudentsListPage = named(students, 'StudentsListPage');
const StudentDetailPage = named(students, 'StudentDetailPage');
const NewStudentPage = named(students, 'NewStudentPage');
const PromotionPage = lazy(() => import('@/pages/admin/PromotionPage'));

const teachersAdmin = () => import('@/pages/admin/TeachersPages');
const TeachersListPage = named(teachersAdmin, 'TeachersListPage');
const TeacherDetailPage = named(teachersAdmin, 'TeacherDetailPage');
const attendanceAdmin = () => import('@/pages/admin/AttendanceAdminPages');
const AttendanceOverviewPage = named(attendanceAdmin, 'AttendanceOverviewPage');
const AdminAttendanceSheetPage = named(attendanceAdmin, 'AdminAttendanceSheetPage');
const CorrectionsPage = named(attendanceAdmin, 'CorrectionsPage');
const AttendanceReportsPage = named(attendanceAdmin, 'AttendanceReportsPage');
const AttendanceSettingsPage = named(attendanceAdmin, 'AttendanceSettingsPage');

const financeAdmin = () => import('@/pages/admin/FinancePages');
const InvoicesPage = named(financeAdmin, 'InvoicesPage');
const InvoiceDetailPage = named(financeAdmin, 'InvoiceDetailPage');
const PaymentsPage = named(financeAdmin, 'PaymentsPage');
const ReceiptPage = named(financeAdmin, 'ReceiptPage');
const GenerateInvoicesPage = named(financeAdmin, 'GenerateInvoicesPage');
const financeSetup = () => import('@/pages/admin/FinanceSetupPages');
const FeeSetupPage = named(financeSetup, 'FeeSetupPage');
const FinanceReportsPage = named(financeSetup, 'FinanceReportsPage');
const examsAdmin = () => import('@/pages/admin/ExamsPages');
const ExamsListPage = named(examsAdmin, 'ExamsListPage');
const ExamDetailPage = named(examsAdmin, 'ExamDetailPage');
const AdminReportCardPage = named(examsAdmin, 'AdminReportCardPage');
const GradingPage = named(examsAdmin, 'GradingPage');

// Teacher portal (separate layout and chunks).
const teacherPortal = () => import('@/pages/teacher/TeacherPortal');
const TeacherLayout = lazy(() => teacherPortal());
const TeacherHomePage = named(teacherPortal, 'TeacherHomePage');
const TeacherSheetPage = named(teacherPortal, 'TeacherSheetPage');
const TeacherSummaryPage = named(teacherPortal, 'TeacherSummaryPage');
const TeacherExamsPage = named(teacherPortal, 'TeacherExamsPage');
const TeacherMarksPage = named(teacherPortal, 'TeacherMarksPage');
const TeacherResultsPage = named(teacherPortal, 'TeacherResultsPage');
const TeacherReportCardPage = named(teacherPortal, 'TeacherReportCardPage');
const TeacherTimetablePage = named(teacherPortal, 'TeacherTimetablePage');
const TeacherResourcesPage = named(teacherPortal, 'TeacherResourcesPage');

// Student / parent portal (separate layout and chunks).
const familyPortal = () => import('@/pages/portal/FamilyPortal');
const FamilyLayout = lazy(() => familyPortal());
const FamilyHomePage = named(familyPortal, 'FamilyHomePage');
const ChildPage = named(familyPortal, 'ChildPage');
const FamilyReportCardPage = named(familyPortal, 'FamilyReportCardPage');
const portalAdmin = () => import('@/pages/admin/PortalAdminPages');
const TimetableAdminPage = named(portalAdmin, 'TimetableAdminPage');
const ResourcesAdminPage = named(portalAdmin, 'ResourcesAdminPage');
const LinkRequestsPage = named(portalAdmin, 'LinkRequestsPage');

const CONTENT_KINDS: ContentKind[] = ['notices', 'events', 'gallery', 'documents'];

export default function App() {
  return (
    <LanguageProvider>
      <AuthProvider>
        <InstitutionProvider>
          <BrowserRouter>
            <Routes>
              <Route path="portal" element={<FamilyLayout />}>
                <Route index element={<FamilyHomePage />} />
                <Route path="s/:studentId" element={<ChildPage />} />
                <Route path="s/:studentId/report/:examId" element={<FamilyReportCardPage />} />
                <Route path="account" element={<AccountPage />} />
              </Route>
              <Route path="teacher" element={<TeacherLayout />}>
                <Route index element={<TeacherHomePage />} />
                <Route path="attendance/:sectionId" element={<TeacherSheetPage />} />
                <Route path="summary/:sectionId" element={<TeacherSummaryPage />} />
                <Route path="exams" element={<TeacherExamsPage />} />
                <Route path="marks/:examSubjectId/:sectionId" element={<TeacherMarksPage />} />
                <Route path="results/:examId/:sectionId" element={<TeacherResultsPage />} />
                <Route path="report/:examId/:studentId" element={<TeacherReportCardPage />} />
                <Route path="timetable" element={<TeacherTimetablePage />} />
                <Route path="resources" element={<TeacherResourcesPage />} />
              </Route>
              <Route path="admin" element={<AdminLayout />}>
                <Route index element={<DashboardPage />} />
                {CONTENT_KINDS.map((kind) => (
                  <Route key={kind} path={`content/${kind}`}>
                    <Route
                      index
                      element={
                        <RequireRoles roles={CONTENT_ROLES}>
                          <ContentListPage key={kind} kind={kind} />
                        </RequireRoles>
                      }
                    />
                    <Route
                      path=":id"
                      element={
                        <RequireRoles roles={CONTENT_ROLES}>
                          <ContentEditPage key={kind} kind={kind} />
                        </RequireRoles>
                      }
                    />
                  </Route>
                ))}
                <Route path="admissions" element={<RequireRoles roles={ADMISSION_VIEW_ROLES}><ApplicationsListPage /></RequireRoles>} />
                <Route path="admissions/:id" element={<RequireRoles roles={ADMISSION_VIEW_ROLES}><ApplicationDetailPage /></RequireRoles>} />
                <Route path="admissions-settings" element={<RequireRoles roles={ACADEMIC_ADMIN_ROLES}><AdmissionSettingsPage /></RequireRoles>} />
                <Route path="academics" element={<RequireRoles roles={ACADEMIC_ADMIN_ROLES}><AcademicSetupPage /></RequireRoles>} />
                <Route path="students" element={<RequireRoles roles={STUDENT_VIEW_ROLES}><StudentsListPage /></RequireRoles>} />
                <Route path="students/new" element={<RequireRoles roles={STUDENT_MANAGE_ROLES}><NewStudentPage /></RequireRoles>} />
                <Route path="students/:id" element={<RequireRoles roles={STUDENT_VIEW_ROLES}><StudentDetailPage /></RequireRoles>} />
                <Route path="promotion" element={<RequireRoles roles={STUDENT_MANAGE_ROLES}><PromotionPage /></RequireRoles>} />
                <Route path="finance/invoices" element={<RequireRoles roles={FINANCE_VIEW_ROLES}><InvoicesPage /></RequireRoles>} />
                <Route path="finance/invoices/:id" element={<RequireRoles roles={FINANCE_VIEW_ROLES}><InvoiceDetailPage /></RequireRoles>} />
                <Route path="finance/payments" element={<RequireRoles roles={FINANCE_VIEW_ROLES}><PaymentsPage /></RequireRoles>} />
                <Route path="finance/receipts/:id" element={<RequireRoles roles={FINANCE_VIEW_ROLES}><ReceiptPage /></RequireRoles>} />
                <Route path="finance/generate" element={<RequireRoles roles={FINANCE_MANAGE_ROLES}><GenerateInvoicesPage /></RequireRoles>} />
                <Route path="finance/setup" element={<RequireRoles roles={FINANCE_VIEW_ROLES}><FeeSetupPage /></RequireRoles>} />
                <Route path="finance/reports" element={<RequireRoles roles={FINANCE_VIEW_ROLES}><FinanceReportsPage /></RequireRoles>} />
                <Route path="exams" element={<RequireRoles roles={EXAM_VIEW_ROLES}><ExamsListPage /></RequireRoles>} />
                <Route path="exams/:id" element={<RequireRoles roles={EXAM_VIEW_ROLES}><ExamDetailPage /></RequireRoles>} />
                <Route path="exams/:id/report/:studentId" element={<RequireRoles roles={EXAM_VIEW_ROLES}><AdminReportCardPage /></RequireRoles>} />
                <Route path="grading" element={<RequireRoles roles={EXAM_VIEW_ROLES}><GradingPage /></RequireRoles>} />
                <Route path="timetable" element={<RequireRoles roles={TEACHING_ADMIN_ROLES}><TimetableAdminPage /></RequireRoles>} />
                <Route path="resources" element={<RequireRoles roles={EXAM_VIEW_ROLES}><ResourcesAdminPage /></RequireRoles>} />
                <Route path="link-requests" element={<RequireRoles roles={STUDENT_MANAGE_ROLES}><LinkRequestsPage /></RequireRoles>} />
                <Route path="teachers" element={<RequireRoles roles={TEACHING_ADMIN_ROLES}><TeachersListPage /></RequireRoles>} />
                <Route path="teachers/:id" element={<RequireRoles roles={TEACHING_ADMIN_ROLES}><TeacherDetailPage /></RequireRoles>} />
                <Route path="attendance" element={<RequireRoles roles={ATTENDANCE_VIEW_ROLES}><AttendanceOverviewPage /></RequireRoles>} />
                <Route path="attendance/sheet/:sectionId" element={<RequireRoles roles={ATTENDANCE_VIEW_ROLES}><AdminAttendanceSheetPage /></RequireRoles>} />
                <Route path="attendance-corrections" element={<RequireRoles roles={ATTENDANCE_VIEW_ROLES}><CorrectionsPage /></RequireRoles>} />
                <Route path="attendance-reports" element={<RequireRoles roles={ATTENDANCE_VIEW_ROLES}><AttendanceReportsPage /></RequireRoles>} />
                <Route path="attendance-settings" element={<RequireRoles roles={TEACHING_ADMIN_ROLES}><AttendanceSettingsPage /></RequireRoles>} />
                <Route path="users" element={<RequireRoles roles={USER_ADMIN_ROLES}><UsersListPage /></RequireRoles>} />
                <Route path="users/:id" element={<RequireRoles roles={USER_ADMIN_ROLES}><UserDetailPage /></RequireRoles>} />
                <Route path="settings" element={<RequireRoles roles={SETTINGS_VIEW_ROLES}><SettingsPage /></RequireRoles>} />
                <Route path="audit" element={<RequireRoles roles={AUDIT_ROLES}><AuditPage /></RequireRoles>} />
                <Route path="security" element={<RequireRoles roles={AUDIT_ROLES}><SecurityPage /></RequireRoles>} />
                <Route path="reports" element={<RequireRoles roles={REPORT_ROLES}><ReportsPage /></RequireRoles>} />
                <Route path="notifications" element={<RequireRoles roles={NOTIFICATION_ROLES}><NotificationsPage /></RequireRoles>} />
                <Route path="account" element={<AccountPage />} />
              </Route>
              <Route element={<PublicLayout />}>
                <Route index element={<HomePage />} />
                <Route path="about" element={<AboutPage />} />
                <Route path="mission-vision" element={<MissionVisionPage />} />
                <Route path="faculty" element={<FacultyPage />} />
                <Route path="academics" element={<AcademicsPage />} />
                <Route path="academics/bangla-medium" element={<StreamPage stream="bangla_medium" />} />
                <Route path="academics/english-version" element={<StreamPage stream="english_version" />} />
                <Route path="admissions" element={<AdmissionsPage />} />
                <Route path="admissions/requirements" element={<RequirementsPage />} />
                <Route path="admissions/apply" element={<AdmissionApplyPage />} />
                <Route path="admissions/status" element={<AdmissionStatusPage />} />
                <Route path="notices" element={<NoticesPage />} />
                <Route path="notices/:id" element={<NoticeDetailPage />} />
                <Route path="academic-calendar" element={<CalendarPage />} />
                <Route path="events" element={<EventsPage />} />
                <Route path="gallery" element={<GalleryPage />} />
                <Route path="examinations" element={<ExaminationsPage />} />
                <Route path="resources" element={<ResourcesPage />} />
                <Route path="contact" element={<ContactPage />} />
                <Route path="faq" element={<FaqPage />} />
                <Route path="privacy" element={<PrivacyPage />} />
                <Route path="terms" element={<TermsPage />} />
                <Route path="login" element={<LoginPage />} />
                <Route path="reset-password" element={<ResetPasswordPage />} />
                <Route path="*" element={<NotFoundPage />} />
              </Route>
            </Routes>
          </BrowserRouter>
        </InstitutionProvider>
      </AuthProvider>
    </LanguageProvider>
  );
}
