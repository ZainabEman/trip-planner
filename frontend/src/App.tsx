import { AppShell } from './components/AppShell';
import { useHashRoute } from './hooks/useHashRoute';
import { DashboardPage } from './pages/DashboardPage';
import { FaqPage } from './pages/FaqPage';
import { HistoryPage } from './pages/HistoryPage';
import { HoursOfServicePage } from './pages/HoursOfServicePage';
import { SupportPage } from './pages/SupportPage';
import { TripDetailsPage } from './pages/TripDetailsPage';
import { TripPlannerPage } from './pages/TripPlannerPage';

function App() {
  const { route } = useHashRoute();

  return (
    <AppShell route={route.key}>
      {route.key === 'dashboard' && <DashboardPage />}
      {route.key === 'planner' && <TripPlannerPage />}
      {route.key === 'history' && <HistoryPage />}
      {/* Remount on id change so the details page refetches. */}
      {route.key === 'trip' && route.tripId && (
        <TripDetailsPage key={route.tripId} tripId={route.tripId} />
      )}
      {route.key === 'hos' && <HoursOfServicePage />}
      {route.key === 'faq' && <FaqPage />}
      {route.key === 'support' && <SupportPage />}
    </AppShell>
  );
}

export default App;
