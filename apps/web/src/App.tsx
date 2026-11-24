import { Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from './components/AppShell';
import { RequireAuth } from './components/RequireAuth';
import { LoginPage } from './pages/LoginPage';
import { PipelineEditorPage } from './pages/PipelineEditorPage';
import { PlannedPage } from './pages/PlannedPage';
import { ProjectRunsPage } from './pages/ProjectRunsPage';
import { ProjectsPage } from './pages/ProjectsPage';
import { RegisterPage } from './pages/RegisterPage';
import { RunPage } from './pages/RunPage';

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route
        element={
          <RequireAuth>
            <AppShell />
          </RequireAuth>
        }
      >
        <Route path="/projects" element={<ProjectsPage />} />
        <Route path="/projects/:projectId" element={<ProjectRunsPage />} />
        <Route path="/runs/:runId" element={<RunPage />} />
        <Route path="/editor" element={<PipelineEditorPage />} />
        <Route path="/planned/:section" element={<PlannedPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/projects" replace />} />
    </Routes>
  );
}
