import { useEffect } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { FirebaseErrorBoundary } from './components/FirebaseErrorBoundary';
import { ProtectedRoute } from './components/ProtectedRoute';
import { ROUTES } from './configuration/routes';
import { AuthProvider } from './hooks/useAuth';
import { StorefrontSettingsProvider } from './hooks/useStorefrontSettings';
import { CustomerLayout } from './layouts/CustomerLayout';
import { AdminCurrenciesPage } from './pages/admin/AdminCurrenciesPage';
import { AdminCustomersPage } from './pages/admin/AdminCustomersPage';
import { AdminDashboardPage } from './pages/admin/AdminDashboardPage';
import { AdminGamesPage } from './pages/admin/AdminGamesPage';
import { AdminLoginPage } from './pages/admin/AdminLoginPage';
import { AdminMediaPage } from './pages/admin/AdminMediaPage';
import { AdminOrdersPage } from './pages/admin/AdminOrdersPage';
import { AdminPackagesPage } from './pages/admin/AdminPackagesPage';
import { AdminPricingPage } from './pages/admin/AdminPricingPage';
import { AdminProfilePage } from './pages/admin/AdminProfilePage';
import { AdminSettingsPage } from './pages/admin/AdminSettingsPage';
import { AdminSuppliersPage } from './pages/admin/AdminSuppliersPage';
import { AdminWebsiteSettingsPage } from './pages/admin/AdminWebsiteSettingsPage';
import { AccountPage } from './pages/customer/AccountPage';
import { ContactPage } from './pages/customer/ContactPage';
import { GameDetailsPage } from './pages/customer/GameDetailsPage';
import { GamesPage } from './pages/customer/GamesPage';
import { HomePage } from './pages/customer/HomePage';
import { LoginPage } from './pages/customer/LoginPage';
import { OrderReviewPage } from './pages/customer/OrderReviewPage';
import { OrdersPage } from './pages/customer/OrdersPage';
import { PolicyPage } from './pages/customer/PolicyPage';
import { RegisterPage } from './pages/customer/RegisterPage';

function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' as ScrollBehavior });
  }, [pathname]);
  return null;
}

export default function App() {
  return (
    <FirebaseErrorBoundary>
      <AuthProvider>
      <StorefrontSettingsProvider>
        <BrowserRouter>
          <ScrollToTop />
          <Routes>
            {/* Customer Storefront Routes */}
            <Route
              path={ROUTES.HOME}
              element={
                <CustomerLayout>
                  <HomePage />
                </CustomerLayout>
              }
            />
            <Route
              path={ROUTES.GAMES}
              element={
                <CustomerLayout>
                  <GamesPage />
                </CustomerLayout>
              }
            />
            <Route
              path={ROUTES.GAME_DETAILS}
              element={
                <CustomerLayout>
                  <GameDetailsPage />
                </CustomerLayout>
              }
            />
            <Route
              path={ROUTES.ORDER_REVIEW}
              element={
                <CustomerLayout>
                  <OrderReviewPage />
                </CustomerLayout>
              }
            />
            <Route
              path={ROUTES.LOGIN}
              element={
                <CustomerLayout>
                  <LoginPage />
                </CustomerLayout>
              }
            />
            <Route
              path={ROUTES.REGISTER}
              element={
                <CustomerLayout>
                  <RegisterPage />
                </CustomerLayout>
              }
            />
            <Route
              path={ROUTES.ACCOUNT}
              element={
                <CustomerLayout>
                  <ProtectedRoute>
                    <AccountPage />
                  </ProtectedRoute>
                </CustomerLayout>
              }
            />
            <Route
              path={ROUTES.ORDERS}
              element={
                <CustomerLayout>
                  <ProtectedRoute>
                    <OrdersPage />
                  </ProtectedRoute>
                </CustomerLayout>
              }
            />
            <Route
              path={ROUTES.CONTACT}
              element={
                <CustomerLayout>
                  <ContactPage />
                </CustomerLayout>
              }
            />
            <Route
              path={ROUTES.TERMS}
              element={
                <CustomerLayout>
                  <PolicyPage type="terms" />
                </CustomerLayout>
              }
            />
            <Route
              path={ROUTES.PRIVACY}
              element={
                <CustomerLayout>
                  <PolicyPage type="privacy" />
                </CustomerLayout>
              }
            />
            <Route
              path={ROUTES.REFUND_POLICY}
              element={
                <CustomerLayout>
                  <PolicyPage type="refund" />
                </CustomerLayout>
              }
            />

            {/* Protected Admin Routes */}
            <Route path={ROUTES.ADMIN_LOGIN} element={<AdminLoginPage />} />
            <Route
              path={ROUTES.ADMIN_DASHBOARD}
              element={
                <ProtectedRoute requireAdmin>
                  <AdminDashboardPage />
                </ProtectedRoute>
              }
            />
            <Route
              path={ROUTES.ADMIN_GAMES}
              element={
                <ProtectedRoute requireAdmin>
                  <AdminGamesPage />
                </ProtectedRoute>
              }
            />
            <Route
              path={ROUTES.ADMIN_CURRENCIES}
              element={
                <ProtectedRoute requireAdmin>
                  <AdminCurrenciesPage />
                </ProtectedRoute>
              }
            />
            <Route
              path={ROUTES.ADMIN_PACKAGES}
              element={
                <ProtectedRoute requireAdmin>
                  <AdminPackagesPage />
                </ProtectedRoute>
              }
            />
            <Route
              path={ROUTES.ADMIN_PRICING}
              element={
                <ProtectedRoute requireAdmin>
                  <AdminPricingPage />
                </ProtectedRoute>
              }
            />
            <Route
              path={ROUTES.ADMIN_ORDERS}
              element={
                <ProtectedRoute requireAdmin>
                  <AdminOrdersPage />
                </ProtectedRoute>
              }
            />
            <Route
              path={ROUTES.ADMIN_SUPPLIERS}
              element={
                <ProtectedRoute requireAdmin>
                  <AdminSuppliersPage />
                </ProtectedRoute>
              }
            />
            <Route
              path={ROUTES.ADMIN_CUSTOMERS}
              element={
                <ProtectedRoute requireAdmin>
                  <AdminCustomersPage />
                </ProtectedRoute>
              }
            />
            <Route
              path={ROUTES.ADMIN_MEDIA}
              element={
                <ProtectedRoute requireAdmin>
                  <AdminMediaPage />
                </ProtectedRoute>
              }
            />
            <Route
              path={ROUTES.ADMIN_WEBSITE_SETTINGS}
              element={
                <ProtectedRoute requireAdmin>
                  <AdminWebsiteSettingsPage />
                </ProtectedRoute>
              }
            />
            <Route
              path={ROUTES.ADMIN_PROFILE}
              element={
                <ProtectedRoute requireAdmin>
                  <AdminProfilePage />
                </ProtectedRoute>
              }
            />
            <Route
              path={ROUTES.ADMIN_SETTINGS}
              element={
                <ProtectedRoute requireAdmin>
                  <AdminSettingsPage />
                </ProtectedRoute>
              }
            />

            <Route path="*" element={<Navigate to={ROUTES.HOME} replace />} />
          </Routes>
        </BrowserRouter>
      </StorefrontSettingsProvider>
    </AuthProvider>
    </FirebaseErrorBoundary>
  );
}
